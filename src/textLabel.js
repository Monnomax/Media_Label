import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Pango from "gi://Pango";
import GLib from "gi://GLib";
import { TextFadeEffect } from "./textFadeEffect.js";
import { getTextFadeState } from "./textFadeGeometry.js";
import { cleanTrackTitle, getCleanupWordsForPreset } from "./titleCleanup.js";

export const TrackLabel = GObject.registerClass(
    { GTypeName: "TrackLabel" },
    class TrackLabel extends St.Widget {
        _init(settings, indicator = null) {
            super._init({
                style_class: "mpris-track-info-container",
                clip_to_allocation: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.START,
                reactive: false,
                can_focus: false,
            });

            this._indicator = indicator;
            this._isDestroyed = false; // Прапорець для відстеження життєвого циклу

            this._label = new St.Label({
                text: "Очікування...",
                style_class: "mpris-track-info",
            });

            this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this.add_child(this._label);

            // Маска застосовується до контейнера тексту, а не до всієї кнопки.
            this._fadeEffect = null;
            try {
                this._fadeEffect = new TextFadeEffect();
                this._fadeEffect.set_enabled(false);
                this.add_effect(this._fadeEffect);
            } catch (e) {
                console.warn(`Media Label: text fade shader unavailable: ${e.message}`);
                this._fadeEffect = null;
            }

            this._labelTranslationNotifyId = this._label.connect(
                "notify::translation-x",
                () => this._updateFadeMask(),
            );

            this.connect("destroy", () => {
                this._isDestroyed = true;
                this._settingsIds = [];

                const label = this._label;
                if (label && this._labelTranslationNotifyId) {
                    try {
                        label.disconnect(this._labelTranslationNotifyId);
                    } catch (e) {}
                }
                this._labelTranslationNotifyId = 0;
                this._destroyFadeEffect();
                this._label = null;

                if (this._scrollTimeoutId) {
                    GLib.source_remove(this._scrollTimeoutId);
                    this._scrollTimeoutId = null;
                }
                if (this._idleId) {
                    GLib.source_remove(this._idleId);
                    this._idleId = null;
                }

                if (label) {
                    try {
                        label.remove_all_transitions();
                        label.translation_x = 0;
                    } catch (e) {}
                }
            });

            this._settings = settings || null;
            this._settingsIds = [];
            this._lastMetadata = null;

            if (this._settings) {
                for (const key of [
                    "marquee-speed",
                    "marquee-delay-start",
                    "marquee-delay-end",
                ]) {
                    this._settingsIds.push(
                        this._settings.connect(`changed::${key}`, () => {
                            if (!this._isDestroyed) this._setupMarquee();
                        }),
                    );
                }

                for (const key of [
                    "title-cleanup-preset",
                    "title-cleanup-custom-words",
                ]) {
                    this._settingsIds.push(
                        this._settings.connect(`changed::${key}`, () => {
                            if (!this._isDestroyed)
                                this.updateFromMetadata(this._lastMetadata);
                        }),
                    );
                }
            }

            this._scrollTimeoutId = null;
            this._idleId = null;
            this._maxWidth = 200;

            this.connect("notify::allocation", () => {
                if (!this._isDestroyed) this._setupMarquee();
            });
        }

        vfunc_get_preferred_width(forHeight) {
            if (!this._label || this._isDestroyed) return [0, 0];

            let [minWidth, natWidth] =
                this._label.get_preferred_width(forHeight);

            if (this._maxWidth) {
                return [
                    Math.min(minWidth, this._maxWidth),
                    Math.min(natWidth, this._maxWidth),
                ];
            }

            return [minWidth, natWidth];
        }

        vfunc_get_preferred_height(forWidth) {
            if (!this._label || this._isDestroyed) return [0, 0];
            let [minWidth, natWidth] = this._label.get_preferred_width(-1);
            return this._label.get_preferred_height(natWidth);
        }

        vfunc_allocate(box) {
            this.set_allocation(box);

            if (!this._label || this._isDestroyed) return;

            let [minWidth, natWidth] = this._label.get_preferred_width(-1);
            let [minHeight, natHeight] = this._label.get_preferred_height(-1);

            let childBox = new Clutter.ActorBox();
            childBox.x1 = 0;
            childBox.y1 = Math.round((box.get_height() - natHeight) / 2);
            childBox.x2 = natWidth;
            childBox.y2 = childBox.y1 + natHeight;

            this._label.allocate(childBox);
        }

        updateFromMetadata(metadata) {
            if (this._isDestroyed) return;

            this._lastMetadata = metadata || null;

            if (!metadata || Object.keys(metadata).length === 0) {
                this.set_text("Плеєр не передав дані");
                return;
            }

            let artist = "";
            if (metadata["xesam:artist"]) {
                let artists = metadata["xesam:artist"];
                artist = Array.isArray(artists)
                    ? artists.join(", ")
                    : String(artists);
            }

            let title = "";
            if (metadata["xesam:title"]) {
                title = String(metadata["xesam:title"]);
            } else {
                title = "Невідомий трек";
            }

            artist = artist.trim();
            title = this._applyTitleCleanup(title.trim());

            const isJunk = (str) => {
                if (!str) return true;
                const clean = str.replace(/[\s\-\—\–\_]/g, "");
                return (
                    clean.length === 0 ||
                    str.toLowerCase() === "unknown" ||
                    str.toLowerCase() === "невідомий"
                );
            };

            let labelParts = [];

            if (!isJunk(artist)) labelParts.push(artist);
            if (!isJunk(title)) labelParts.push(title);

            let finalText = labelParts.join(" - ");
            finalText = finalText.replace(/^[\s\-\—\–]+/, "");

            if (!finalText) finalText = "Невідомий трек";

            this.set_text(finalText);
        }

        _applyTitleCleanup(title) {
            if (!this._settings || !title) return title;

            const preset =
                this._settings.get_string("title-cleanup-preset") || "off";
            if (preset === "off") return title;

            let customWords = [];
            if (preset === "custom") {
                try {
                    customWords = JSON.parse(
                        this._settings.get_string(
                            "title-cleanup-custom-words",
                        ) || "[]",
                    );
                } catch (e) {
                    customWords = [];
                }
            }

            const words = getCleanupWordsForPreset(preset, customWords);
            if (words.length === 0) return title;

            return cleanTrackTitle(title, words);
        }

        set_text(text) {
            if (this._isDestroyed || !this._label) return;

            if (this._label.get_text() === text) return;

            this._stopMarquee();

            const currentWidth = this.width;
            if (currentWidth > 0 && this.get_allocation_box()) {
                this.set_width(currentWidth);
            }

            this._label.set_text(text);

            let [, textNatWidth] = this._label.get_preferred_width(-1);
            const targetWidth =
                this._maxWidth > 0
                    ? Math.min(textNatWidth, this._maxWidth)
                    : textNatWidth;

            this._animateWidth(targetWidth, true, () =>
                this._queueMarqueeAndRelayout(),
            );
        }

        getNaturalWidth() {
            if (!this._label || this._isDestroyed) return 0;
            const [, natWidth] = this._label.get_preferred_width(-1);
            return this._maxWidth > 0
                ? Math.min(natWidth, this._maxWidth)
                : natWidth;
        }

        growToFit(minWidth) {
            if (this._isDestroyed) return;
            const natural = this.getNaturalWidth();
            const cap = this._maxWidth > 0 ? this._maxWidth : Infinity;
            const target = Math.min(Math.max(natural, minWidth), cap);
            this._animateWidth(target, false);
        }

        restoreNaturalWidth() {
            if (this._isDestroyed) return;
            this._animateWidth(this.getNaturalWidth(), true);
        }

        _animateWidth(targetWidth, release, onComplete) {
            if (this._isDestroyed) return;

            const currentWidth = this.width;
            this.remove_transition("width");

            if (currentWidth <= 0 || !this.get_allocation_box()) {
                this.set_width(release ? -1 : targetWidth);
                this.queue_relayout();
                onComplete?.();
                return;
            }

            if (Math.round(currentWidth) === Math.round(targetWidth)) {
                if (release) this.set_width(-1);
                onComplete?.();
                return;
            }

            this.set_width(currentWidth);
            this.ease({
                width: targetWidth,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (this._isDestroyed) return;

                    if (release) this.set_width(-1);
                    onComplete?.();
                },
            });
        }

        _queueMarqueeAndRelayout() {
            if (this._idleId) {
                GLib.source_remove(this._idleId);
            }

            this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idleId = null;
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;

                this.queue_relayout();
                this._setupMarquee();
                return GLib.SOURCE_REMOVE;
            });
        }

        applyWidth(maxWidth) {
            if (this._isDestroyed) return;
            this._maxWidth = maxWidth;
            this.max_width = maxWidth;
            this.set_style(`max-width: ${maxWidth}px;`);
            this.queue_relayout();
        }

        applyTextColor(color) {
            if (this._isDestroyed || !this._label) return;

            if (color) {
                this._label.set_style(
                    `color: rgb(${color.r}, ${color.g}, ${color.b});`,
                );
            } else {
                this._label.set_style(null);
            }
        }

        _stopMarquee() {
            if (this._scrollTimeoutId) {
                GLib.source_remove(this._scrollTimeoutId);
                this._scrollTimeoutId = null;
            }
            if (this._idleId) {
                GLib.source_remove(this._idleId);
                this._idleId = null;
            }
            const label = this._label;
            if (label) {
                try {
                    label.remove_all_transitions();
                    label.translation_x = 0;
                } catch (e) {}
            }
        }

        _updateFadeMask() {
            if (this._isDestroyed || !this._label || !this._fadeEffect) return;

            let containerWidth = this.width;
            if (
                this._maxWidth > 0 &&
                (containerWidth <= 0 || containerWidth > this._maxWidth)
            ) {
                containerWidth = this._maxWidth;
            }

            if (containerWidth <= 0) {
                this._fadeEffect.setFade(false, false);
                return;
            }

            let textWidth;
            try {
                [, textWidth] = this._label.get_preferred_width(-1);
            } catch (e) {
                return;
            }

            const state = getTextFadeState(
                this._label.translation_x,
                textWidth,
                containerWidth,
            );
            this._fadeEffect.setFade(state.left, state.right);
        }

        _destroyFadeEffect() {
            const effect = this._fadeEffect;
            this._fadeEffect = null;
            if (!effect) return;

            try {
                effect.stopAnimation();
            } catch (e) {}

            try {
                this.remove_effect(effect);
            } catch (e) {}
        }

        _setupMarquee() {
            if (this._isDestroyed) return;
            this._stopMarquee();

            let containerWidth = this.width;
            if (
                this._maxWidth > 0 &&
                (containerWidth <= 0 || containerWidth > this._maxWidth)
            ) {
                containerWidth = this._maxWidth;
            }

            if (containerWidth <= 0 || !this._label) return;

            let textWidth;
            try {
                [, textWidth] = this._label.get_preferred_width(-1);
            } catch (e) {
                return;
            }

            if (textWidth <= containerWidth) {
                this._updateFadeMask();
                return;
            }

            let diff = textWidth - containerWidth;
            this._updateFadeMask();
            const SPEED_PX_PER_SEC = this._settings
                ? this._settings.get_int("marquee-speed")
                : 60;
            const DELAY_START = this._settings
                ? this._settings.get_int("marquee-delay-start")
                : 2000;
            const DELAY_END = this._settings
                ? this._settings.get_int("marquee-delay-end")
                : 2000;
            let durationMs = (diff / SPEED_PX_PER_SEC) * 1000;

            let runMarqueeCycle = () => {
                if (this._isDestroyed) return;

                const loopLabel = this._label;
                if (!loopLabel || this._isDestroyed) return;

                this._scrollTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    DELAY_START,
                    () => {
                        this._scrollTimeoutId = null;
                        const activeLabel = this._label;
                        if (this._isDestroyed || !activeLabel)
                            return GLib.SOURCE_REMOVE;

                        try {
                            activeLabel.ease({
                                translation_x: -diff,
                                duration: durationMs,
                                mode: Clutter.AnimationMode.LINEAR,
                                onComplete: () => {
                                    if (this._isDestroyed || !this._label)
                                        return;

                                    this._scrollTimeoutId = GLib.timeout_add(
                                        GLib.PRIORITY_DEFAULT,
                                        DELAY_END,
                                        () => {
                                            this._scrollTimeoutId = null;
                                            const returnLabel = this._label;
                                            if (
                                                this._isDestroyed ||
                                                !returnLabel
                                            )
                                                return GLib.SOURCE_REMOVE;

                                            try {
                                                returnLabel.ease({
                                                    translation_x: 0,
                                                    duration: durationMs,
                                                    mode: Clutter.AnimationMode
                                                        .LINEAR,
                                                    onComplete: () => {
                                                        if (
                                                            this._isDestroyed ||
                                                            !this._label
                                                        )
                                                            return;
                                                        runMarqueeCycle();
                                                    },
                                                });
                                            } catch (e) {
                                                return GLib.SOURCE_REMOVE;
                                            }
                                            return GLib.SOURCE_REMOVE;
                                        },
                                    );
                                },
                            });
                        } catch (e) {
                            return GLib.SOURCE_REMOVE;
                        }
                        return GLib.SOURCE_REMOVE;
                    },
                );
            };

            runMarqueeCycle();
        }

        destroy() {
            this._isDestroyed = true;
            this._stopMarquee();
            if (this._settings && this._settingsIds) {
                for (const id of this._settingsIds)
                    this._settings.disconnect(id);
                this._settingsIds = [];
            }
            if (this._label && this._labelTranslationNotifyId) {
                try {
                    this._label.disconnect(this._labelTranslationNotifyId);
                } catch (e) {}
            }
            this._labelTranslationNotifyId = 0;
            this._destroyFadeEffect();
            this._label = null;
            super.destroy();
        }
    },
);
