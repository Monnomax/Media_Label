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

            // Стартова висота: якщо кнопка індикатора вже має реальну висоту
            // (рідко на цьому етапі — вона ще не вставлена в панель), беремо її,
            // інакше — безпечний дефолт, який одразу синхронізується після
            // першого allocate() кнопки через setTargetHeight().
            const initialHeight = Math.round(
                indicator && indicator.height > 0 ? indicator.height : 40,
            );

            this._targetHeight = initialHeight; // актуальна висота кнопки на панелі
            this._width = initialHeight;
            this._height = initialHeight;
            this.set_size(this._width, this._height);

            this._radius = radius;
            this._indicator = indicator;
            this._pixbuf = null; // відмасштабований під поточний розмір pixbuf (для відмальовки)
            this._fullPixbuf = null; // оригінал у повній роздільній здатності (для якісного перемасштабування)
            this._avgColor = null;
            this._isDestroyed = false;

            // --- Crossfade між старою і новою обкладинкою ---
            this._lastArtUrl = undefined; // щоб не перезапускати fade при тій самій обкладинці
            this._oldPixbuf = null; // шар, що згасає (те, що було показано до зміни)
            this._crossfadeProgress = 1; // 0 = щойно почали перехід, 1 = перехід завершено
            this._crossfadeTimerId = null;
            this._crossfadeDuration = 400; // змінено на 400 мс

            // artLabel залишається окремою інтерактивною зоною: кліки та
            // прокрутка тут не запускають керування треком на решті кнопки.
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

                    resolvePreviewArtworkUrl(indicator, mprisArtUrl, openPreview);
                }

                return Clutter.EVENT_STOP;
            });

            this.connect("scroll-event", () => Clutter.EVENT_STOP);

            // Захист від «зомбі»-таймера: якщо актор знищили посеред анімації,
            // GLib.timeout_add інакше продовжить смикати вже знищений DrawingArea.
            this.connect("destroy", () => {
                this._isDestroyed = true;
                this._stopCrossfadeTimer();
            });
        }

        /**
         * Запускає плавний перехід від поточної обкладинки до нової.
         * newFullPixbuf === null означає перехід до плейсхолдера (трек без art).
         */

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

        /**
         * Викликається ззовні (з MediaPlayerIndicator) щоразу, коли реальна
         * висота кнопки на панелі змінюється — наприклад, користувач збільшив
         * висоту панелі через тему чи інше розширення.
         *
         * artLabel синхронно підлаштовує власну висоту під висоту кнопки,
         * перераховуючи ширину так, щоб зберегти співвідношення сторін
         * поточної обкладинки (або лишитись квадратом, якщо обкладинки нема).
         */
        setTargetHeight(height) {
            height = Math.round(height);
            if (!height || height <= 0 || height === this._targetHeight) return;
            this._targetHeight = height;
            this._rescaleToTarget();
        }

        _rescaleToTarget() {
            // Зміна висоти панелі під час активного crossfade — рідкісна подія.
            // Замість того щоб домасштабовувати ще й «старий» шар під нову висоту,
            // просто завершуємо перехід миттєво: різкий стрибок тут непомітний
            // і не вартий додаткової складності.
            if (this._crossfadeTimerId) {
                this._stopCrossfadeTimer();
                this._oldPixbuf = null;
                this._crossfadeProgress = 1;
            }

            const targetHeight = this._targetHeight;

            if (!this._fullPixbuf) {
                // Немає обкладинки — квадратний плейсхолдер під актуальну висоту кнопки
                this._pixbuf = null;
                this._resizeTo(targetHeight, targetHeight);
                this.queue_repaint();
                return;
            }

            const origWidth = this._fullPixbuf.get_width();
            const origHeight = this._fullPixbuf.get_height();

            // Підганяємо під висоту кнопки; ширина слідує за реальними
            // пропорціями обкладинки: квадратна art лишається квадратом,
            // вертикальний постер лишається вертикальним постером — без обрізки.
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

            // Метадані MPRIS оновлюються частіше, ніж сама обкладинка
            // (play/pause теж шле g-properties-changed). Якщо URL той самий —
            // нічого не вантажимо і fade повторно не запускаємо.
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

        /**
         * Запускає плавний перехід від поточної обкладинки до нової.
         * newFullPixbuf === null означає перехід до плейсхолдера (трек без art).
         */
        _beginCrossfade(newFullPixbuf) {
            this._stopCrossfadeTimer();

            this._oldPixbuf = this._pixbuf;
            this._fullPixbuf = newFullPixbuf;

            // 1. Встановлюємо точку масштабування рівно по центру віджета
            this.set_pivot_point(0.5, 0.5);

            // 2. Знімаємо обмеження малювання з самого віджета та його контейнера
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

            // 3. Апаратна анімація Clutter: віджет збільшується, виходячи за свої межі, і повертається назад
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

            // 4. Таймер для Cairo відповідає ТІЛЬКИ за прозорість (crossfade)
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

            // Якщо йде анімація, розширюємо межі малювання на 10% (відповідно до scale 1.1)
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
                // Оскільки масштабування тепер винесене на рівень Clutter-актора,
                // тут ми керуємо лише переходом прозорості.
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

        // Малює один шар (картинку або плейсхолдер) із заданою прозорістю.
        // Область вже обмежена round-rect клипом у vfunc_repaint().
        _paintLayer(cr, pixbuf, width, height, alpha) {
            if (alpha <= 0) return;

            cr.save();

            // Задаємо круглий контур обрізки для поточного шару
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
