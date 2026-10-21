import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Cairo from "gi://cairo";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import { TrackLabel } from "./textLabel.js";
import { CairoRoundedArt } from "./artLabel.js";
import { SeekOverlay } from "./seekOverlay.js";
import { SeekController } from "./seekController.js";
import { ProgressController } from "./progressController.js";
import { DisplayMode } from "./constants.js";
import { PaletteManager } from "./paletteManager.js";
import { MprisPlayerManager } from "./mprisPlayerManager.js";
import { DetailedPlayerWindow } from "./detailedPlayerWindow.js";
import {
    paintPanelProgress,
    updatePanelProgressGeometry,
} from "./panelProgress.js";

import { updateMetadata } from "./metadataController.js";

import {
    setActivePlayer,
    clearActivePlayer,
    updateVisibility,
} from "./activePlayerController.js";

import {
    handlePanelButtonPress,
    handlePanelButtonRelease,
    handlePanelScroll,
    mprisCall,
    mprisSeek,
} from "./userActionController.js";

import {
    applyCustomStyles,
    updateBackground,
    syncThemeButtonPseudoClasses,
} from "./buttonStyleController.js";

export const MediaPlayerIndicator = GObject.registerClass(
    { GTypeName: "MediaPlayerIndicator" },
    class MediaPlayerIndicator extends PanelMenu.Button {
        _init(extension) {
            super._init(0, "MediaPlayerIndicator");
            this._isDestroyed = false;
            this.add_style_class_name("mpris-indicator-main-button");
            this._settings = extension.getSettings();

            this._paletteManager = new PaletteManager();

            this._currentPlayerAddress = null;
            this._playerProxy = null;
            this._currentArtUrl = null;
            this._currentTrackKey = null;

            this._seekActive = false;
            this._seekPositionUnknown = true;
            this._seekPosition = 0;
            this._seekLength = 0;
            this._panelProgressPosition = 0;
            this._panelProgressGeometry = null;
            this._panelProgressTimeoutId = null;
            this._panelProgressPollInFlight = false;
            this._seekHideTimeoutId = null;

            this._longPressTimeoutId = null;

            this.layout = new St.BoxLayout({
                style_class: "mpris-panel-button",
                vertical: false,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                reactive: true,
                track_hover: true,
            });

            const initialRadius = this._settings.get_int("album-radius");
            this.albumArt = new CairoRoundedArt(initialRadius, this);

            this.trackLabel = new TrackLabel(this._settings, this);
            this.seekOverlay = new SeekOverlay();
            this._seekController = new SeekController(this);

            this._trackStack = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                y_align: Clutter.ActorAlign.FILL,
                y_expand: true,
            });
            this._trackStack.add_child(this.trackLabel);
            this._trackStack.add_child(this.seekOverlay);

            this._progressLayer = new St.DrawingArea({
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
                reactive: false,
            });
            this._progressLayer.connect("repaint", (area) => {
                paintPanelProgress(area, {
                    Cairo,
                    geometry: this._panelProgressGeometry,
                    position: this._panelProgressPosition,
                    duration: this._seekLength,
                    radius: this._currentRadius,
                    settings: this._settings,
                });
            });

            this._buttonStack = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
                reactive: true,
                track_hover: true,
            });
            this._buttonStack.add_child(this._progressLayer);

            this.layout.add_child(this.albumArt);
            this.layout.add_child(this._trackStack);
            this._buttonStack.add_child(this.layout);
            this.add_child(this._buttonStack);

            this._visualState = "normal";

            this._buttonStack.connect("enter-event", () => {
                if (this.menu.isOpen) return;
                this._visualState = "hover";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();
            });

            this._buttonStack.connect("leave-event", () => {
                if (!this.menu.isOpen) {
                    this._visualState = "normal";
                    this._syncThemeButtonPseudoClasses();
                    this._updateBackground();
                }

                if (this._longPressTimeoutId) {
                    GLib.source_remove(this._longPressTimeoutId);
                    this._longPressTimeoutId = null;
                }

                if (this._seekActive) {
                    if (this._seekHideTimeoutId) {
                        GLib.source_remove(this._seekHideTimeoutId);
                        this._seekHideTimeoutId = null;
                    }
                    this._exitSeekMode();
                }
            });

            this._buttonStack.connect("button-press-event", (_actor, event) => {
                this._visualState = "pressed";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();

                if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                    if (this._longPressTimeoutId)
                        GLib.source_remove(this._longPressTimeoutId);
                    this._longPressTimeoutId = GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT,
                        500,
                        () => {
                            this._longPressTimeoutId = null;
                            if (!this._isDestroyed) this.menu.toggle();
                            return GLib.SOURCE_REMOVE;
                        },
                    );
                }
                return Clutter.EVENT_STOP;
            });

            this._buttonStack.connect(
                "button-release-event",
                (_actor, event) => {
                    if (!this.menu.isOpen) {
                        this._visualState = "hover";
                        this._syncThemeButtonPseudoClasses();
                        this._updateBackground();
                    }

                    const button = event.get_button();
                    if (button === Clutter.BUTTON_PRIMARY) {
                        if (this._longPressTimeoutId) {
                            GLib.source_remove(this._longPressTimeoutId);
                            this._longPressTimeoutId = null;
                            this._mprisCall("Previous");
                        }
                    } else if (button === Clutter.BUTTON_SECONDARY) {
                        this._mprisCall("Next");
                    } else if (button === Clutter.BUTTON_MIDDLE) {
                        this._mprisCall("PlayPause");
                    }
                    return Clutter.EVENT_STOP;
                },
            );

            this._buttonStack.connect("scroll-event", (_actor, event) => {
                const direction = event.get_scroll_direction();
                if (direction === Clutter.ScrollDirection.UP) {
                    this._handleSeekScroll(5_000_000);
                } else if (direction === Clutter.ScrollDirection.DOWN) {
                    this._handleSeekScroll(-5_000_000);
                }
                return Clutter.EVENT_STOP;
            });

            this._heightNotifyId = this.connect("notify::height", () => {
                if (this.albumArt) this.albumArt.setTargetHeight(this.height);
                this._updatePanelProgressGeometry();
            });
            this._widthNotifyId = this.connect("notify::width", () =>
                this._updatePanelProgressGeometry(),
            );
            this._albumArtWidthNotifyId = this.albumArt.connect(
                "notify::width",
                () => this._updatePanelProgressGeometry(),
            );

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this._isDestroyed && this.height > 0 && this.albumArt)
                    this.albumArt.setTargetHeight(this.height);
                return GLib.SOURCE_REMOVE;
            });

            this._detailedWindow = new DetailedPlayerWindow(this);
            const detailedMenuItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });
            detailedMenuItem.add_child(this._detailedWindow);
            this.menu.addMenuItem(detailedMenuItem);

            this._detailedProgressTimeoutId = null;
            this._progressController = new ProgressController(this);
            this.menu.connect("open-state-changed", (_menu, isOpen) => {
                this._visualState = isOpen ? "pressed" : "normal";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();

                this._progressController.setDetailedProgressPolling(isOpen);
            });

            this._playerManager = new MprisPlayerManager(this._settings, {
                getActiveAddress: () => this._currentPlayerAddress,
                activatePlayer: (address, proxy) =>
                    this._setActivePlayer(address, proxy),
                refreshVisibility: () => this._updateVisibility(),
                clearActivePlayer: () => this._clearActivePlayer(),
            });

            this._settingsId = this._settings.connect("changed", () =>
                this._applyCustomStyles(),
            );
            this._playersSettingsId = this._settings.connect(
                "changed::media-players",
                () => this._updateVisibility(),
            );

            this._themeContext = St.ThemeContext.get_for_stage(global.stage);
            this._themeChangedId = this._themeContext.connect("changed", () => {
                this._paletteManager.resetThemeCache();
                this._applyCustomStyles();
            });

            this._applyCustomStyles();
            this.visible = false;
        }

        _handlePanelButtonPress(event) {
            return handlePanelButtonPress.call(this, event, Clutter, GLib);
        }

        _handlePanelButtonRelease(event) {
            return handlePanelButtonRelease.call(this, event, Clutter, GLib);
        }

        _handlePanelScroll(event) {
            return handlePanelScroll.call(this, event, Clutter);
        }

        _mprisCall(method) {
            return mprisCall.call(this, method);
        }

        _mprisSeek(offsetUs) {
            return mprisSeek.call(this, offsetUs);
        }

        _updatePanelProgressGeometry() {
            return updatePanelProgressGeometry(this);
        }

        _updatePanelProgressFill(position, length) {
            if (this._isDestroyed || !this._progressLayer) return;
            this._panelProgressPosition = Math.max(0, Number(position) || 0);
            this._progressLayer.queue_repaint();
        }

        async _pollPanelProgress() {
            return this._progressController.pollPanelProgress();
        }

        _startPanelProgressPolling() {
            this._progressController.startPanelProgressPolling();
        }

        _stopPanelProgressPolling() {
            this._progressController.stopPanelProgressPolling();
        }

        async _pollDetailedProgress() {
            return this._progressController.pollDetailedProgress();
        }

        _handleSeekScroll(offsetUs) {
            this._seekController.handleSeekScroll(offsetUs);
        }

        _enterSeekMode() {
            this._seekController.enterSeekMode();
        }

        _exitSeekMode() {
            this._seekController.exitSeekMode();
        }

        _resetSeekState() {
            this._seekController.resetSeekState();
        }

        _syncSeekWidth() {
            this._seekController.syncSeekWidth();
        }

        _resetSeekHideTimer() {
            this._seekController.resetSeekHideTimer();
        }

        async _syncSeekPosition(address) {
            return this._seekController.syncSeekPosition(address);
        }

        _applyCustomStyles() {
            return applyCustomStyles.call(this, DisplayMode);
        }

        _updateBackground() {
            return updateBackground.call(this);
        }

        _syncThemeButtonPseudoClasses() {
            return syncThemeButtonPseudoClasses.call(this);
        }

        _setActivePlayer(address, proxy) {
            return setActivePlayer.call(this, address, proxy);
        }

        _clearActivePlayer() {
            return clearActivePlayer.call(this);
        }

        _updateMetadata() {
            updateMetadata.call(this);
        }

        _updateVisibility() {
            return updateVisibility.call(this);
        }

        destroy() {
            this._isDestroyed = true;
            if (this._longPressTimeoutId) {
                GLib.source_remove(this._longPressTimeoutId);
                this._longPressTimeoutId = null;
            }
            if (this._seekHideTimeoutId) {
                GLib.source_remove(this._seekHideTimeoutId);
                this._seekHideTimeoutId = null;
            }
            if (this._progressController)
                this._progressController.stopDetailedProgressPolling();
            this._stopPanelProgressPolling();
            if (this._settingsId) this._settings.disconnect(this._settingsId);
            if (this._playersSettingsId)
                this._settings.disconnect(this._playersSettingsId);
            if (this._heightNotifyId) this.disconnect(this._heightNotifyId);
            if (this._widthNotifyId) this.disconnect(this._widthNotifyId);
            if (this._albumArtWidthNotifyId && this.albumArt)
                this.albumArt.disconnect(this._albumArtWidthNotifyId);
            if (this._themeChangedId && this._themeContext)
                this._themeContext.disconnect(this._themeChangedId);

            if (this._playerManager) this._playerManager.destroy();
            this._playerProxy = null;
            this._currentPlayerAddress = null;

            super.destroy();
        }
    },
);
