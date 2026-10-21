import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GdkPixbuf from "gi://GdkPixbuf";
import Cairo from "gi://cairo";
import Gdk from "gi://Gdk";
import { ArtPreview } from "./artPreview.js";
import { resolvePreviewArtworkUrl } from "./artworkProvider.js";

export const CairoRoundedArt = GObject.registerClass(
    { GTypeName: "CairoRoundedArt" },
    class CairoRoundedArt extends St.DrawingArea {
        _init(radius, indicator) {
            super._init({
                style_class: "mpris-album-art-cairo",
                reactive: true,
                can_focus: true,
                track_hover: true,
            });

            const initialHeight = Math.round(
                indicator && indicator.height > 0 ? indicator.height : 40,
            );

            this._targetHeight = initialHeight;
            this._width = initialHeight;
            this._height = initialHeight;
            this.set_size(this._width, this._height);

            this._radius = radius;
            this._indicator = indicator;
            this._pixbuf = null;
            this._fullPixbuf = null;
            this._avgColor = null;
            this._isDestroyed = false;

            this._lastArtUrl = undefined;
            this._oldPixbuf = null;
            this._crossfadeProgress = 1;
            this._crossfadeTimerId = null;
            this._crossfadeDuration = 400;

            this.connect("button-press-event", () => Clutter.EVENT_STOP);

            this.connect("button-release-event", (_actor, event) => {
                if (
                    event.get_button() === Clutter.BUTTON_PRIMARY &&
                    this._indicator &&
                    this._indicator._currentArtUrl
                ) {
                    const indicator = this._indicator;
                    const mprisArtUrl = indicator._currentArtUrl;
                    const settings = indicator._settings;

                    const openPreview = (url) => {
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                            new ArtPreview(url, settings);
                            return GLib.SOURCE_REMOVE;
                        });
                    };

                    resolvePreviewArtworkUrl(
                        indicator,
                        mprisArtUrl,
                        openPreview,
                    );
                }

                return Clutter.EVENT_STOP;
            });

            this.connect("scroll-event", () => Clutter.EVENT_STOP);

            this.connect("destroy", () => {
                this._isDestroyed = true;
                this._stopCrossfadeTimer();
            });
        }

        vfunc_get_preferred_width(forHeight) {
            return [this._width, this._width];
        }
        vfunc_get_preferred_height(forWidth) {
            return [this._height, this._height];
        }

        _resizeTo(width, height) {
            if (this._width === width && this._height === height) return;
            this._width = width;
            this._height = height;
            this.set_size(width, height);
            this.queue_relayout();
        }

        _stopCrossfadeTimer() {
            if (this._crossfadeTimerId) {
                GLib.source_remove(this._crossfadeTimerId);
                this._crossfadeTimerId = null;
            }
        }

        setTargetHeight(height) {
            height = Math.round(height);
            if (!height || height <= 0 || height === this._targetHeight) return;
            this._targetHeight = height;
            this._rescaleToTarget();
        }

        _rescaleToTarget() {
            if (this._crossfadeTimerId) {
                this._stopCrossfadeTimer();
                this._oldPixbuf = null;
                this._crossfadeProgress = 1;
            }

            const targetHeight = this._targetHeight;

            if (!this._fullPixbuf) {
                this._pixbuf = null;
                this._resizeTo(targetHeight, targetHeight);
                this.queue_repaint();
                return;
            }

            const origWidth = this._fullPixbuf.get_width();
            const origHeight = this._fullPixbuf.get_height();

            const scale = targetHeight / origHeight;
            const scaledWidth = Math.max(1, Math.round(origWidth * scale));

            this._pixbuf = this._fullPixbuf.scale_simple(
                scaledWidth,
                targetHeight,
                GdkPixbuf.InterpType.BILINEAR,
            );

            this._resizeTo(scaledWidth, targetHeight);
            this.queue_repaint();
        }

        async updateArt(artUrl, radius) {
            this._radius = radius;

            if (artUrl === this._lastArtUrl) {
                this.queue_repaint();
                return;
            }
            this._lastArtUrl = artUrl;

            if (!artUrl) {
                this._avgColor = null;
                this._beginCrossfade(null);
                return;
            }

            try {
                let file = Gio.File.new_for_uri(artUrl);
                file.load_contents_async(null, (file, res) => {
                    if (this._isDestroyed) return;
                    try {
                        let [success, contents] =
                            file.load_contents_finish(res);
                        if (success && contents && contents.length > 0) {
                            let loader = new GdkPixbuf.PixbufLoader();
                            loader.write(contents);
                            loader.close();
                            let fullPixbuf = loader.get_pixbuf();
                            if (fullPixbuf) {
                                this._avgColor =
                                    this._getAverageColor(fullPixbuf);
                                this._beginCrossfade(fullPixbuf);
                                if (this._indicator)
                                    this._indicator._applyCustomStyles();
                            }
                        }
                    } catch (e) {
                        log(e.message);
                    }
                });
            } catch (e) {
                log(e.message);
            }
        }

        _beginCrossfade(newFullPixbuf) {
            this._stopCrossfadeTimer();

            this._oldPixbuf = this._pixbuf;
            this._fullPixbuf = newFullPixbuf;

            this.set_pivot_point(0.5, 0.5);

            this.set_clip_to_allocation(false);
            if (this.get_parent()) {
                this.get_parent().set_clip_to_allocation(false);
            }

            if (!newFullPixbuf) {
                this._pixbuf = null;
                this._resizeTo(this._targetHeight, this._targetHeight);
            } else {
                const targetHeight = this._targetHeight;
                const origWidth = newFullPixbuf.get_width();
                const origHeight = newFullPixbuf.get_height();
                const scale = targetHeight / origHeight;
                const scaledWidth = Math.max(1, Math.round(origWidth * scale));

                this._pixbuf = newFullPixbuf.scale_simple(
                    scaledWidth,
                    targetHeight,
                    GdkPixbuf.InterpType.BILINEAR,
                );
                this._resizeTo(scaledWidth, targetHeight);
            }

            if (!this._oldPixbuf) {
                this._crossfadeProgress = 1;
                this.queue_repaint();
                return;
            }

            this._crossfadeProgress = 0;
            const duration = this._crossfadeDuration;
            let startTime = null;

            this.ease({
                scale_x: 1.1,
                scale_y: 1.1,
                duration: duration / 2,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        duration: duration / 2,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    });
                },
            });

            this._crossfadeTimerId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                16,
                () => {
                    if (this._isDestroyed) {
                        this._crossfadeTimerId = null;
                        return GLib.SOURCE_REMOVE;
                    }

                    if (startTime === null) {
                        startTime = GLib.get_monotonic_time();
                        this._crossfadeProgress = 0;
                        this.queue_repaint();
                        return GLib.SOURCE_CONTINUE;
                    }

                    const elapsedMs =
                        (GLib.get_monotonic_time() - startTime) / 1000;
                    const t = Math.min(1, elapsedMs / duration);

                    this._crossfadeProgress = 1 - (1 - t) * (1 - t);
                    this.queue_repaint();

                    if (t >= 1) {
                        this._oldPixbuf = null;
                        this._crossfadeTimerId = null;
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                },
            );
        }

        vfunc_get_paint_volume(volume) {
            let res = super.vfunc_get_paint_volume(volume);

            const isCrossfading =
                this._oldPixbuf && this._crossfadeProgress < 1;

            if (res && isCrossfading) {
                let marginX = this.width * 0.1;
                let marginY = this.height * 0.1;

                volume.set_origin({ x: -marginX, y: -marginY, z: 0 });
                volume.set_width(this.width + marginX * 2);
                volume.set_height(this.height + marginY * 2);
            }

            return res;
        }

        vfunc_repaint() {
            let cr = this.get_context();
            let [width, height] = this.get_surface_size();
            if (width === 0 || height === 0) return;

            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);

            const isCrossfading =
                this._oldPixbuf && this._crossfadeProgress < 1;

            if (isCrossfading) {
                this._paintLayer(
                    cr,
                    this._oldPixbuf,
                    width,
                    height,
                    1 - this._crossfadeProgress,
                );
                this._paintLayer(
                    cr,
                    this._pixbuf,
                    width,
                    height,
                    this._crossfadeProgress,
                );
            } else {
                this._paintLayer(cr, this._pixbuf, width, height, 1);
            }

            cr.$dispose();
        }

        _paintLayer(cr, pixbuf, width, height, alpha) {
            if (alpha <= 0) return;

            cr.save();

            let r = Math.min(this._radius, width / 2, height / 2);
            cr.newSubPath();
            cr.arc(width - r, r, r, -Math.PI / 2, 0);
            cr.arc(width - r, height - r, r, 0, Math.PI / 2);
            cr.arc(r, height - r, r, Math.PI / 2, Math.PI);
            cr.arc(r, r, r, Math.PI, -Math.PI / 2);
            cr.closePath();
            cr.clip();

            if (pixbuf) {
                const pixbufWidth = pixbuf.get_width();
                const pixbufHeight = pixbuf.get_height();
                const offsetX = (width - pixbufWidth) / 2;
                const offsetY = (height - pixbufHeight) / 2;

                Gdk.cairo_set_source_pixbuf(cr, pixbuf, offsetX, offsetY);
                cr.paintWithAlpha(alpha);
            } else {
                cr.setSourceRGBA(1, 1, 1, 0.1 * alpha);
                cr.paint();
            }

            cr.restore();
        }

        _getAverageColor(pixbuf) {
            if (!pixbuf) return null;
            let small = pixbuf.scale_simple(
                1,
                1,
                GdkPixbuf.InterpType.BILINEAR,
            );
            let pixels = small.get_pixels();
            return { r: pixels[0], g: pixels[1], b: pixels[2] };
        }
    },
);
