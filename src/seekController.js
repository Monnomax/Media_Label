import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { calculateSeekPosition } from "./seekUtils.js";

/**
 * Encapsulates seek interaction and its transient overlay state.
 * The indicator remains the owner of player/session state and UI actors;
 * this controller coordinates those existing objects without changing their API.
 */
export class SeekController {
    constructor(indicator) {
        this._indicator = indicator;
    }

    handleSeekScroll(offsetUs) {
        const indicator = this._indicator;
        if (indicator._isDestroyed || !indicator._currentPlayerAddress) return;

        indicator._mprisSeek(offsetUs);

        if (!indicator._seekActive) this.enterSeekMode();

        indicator._seekPosition = calculateSeekPosition(
            indicator._seekPosition,
            offsetUs,
            indicator._seekLength || 0,
        );
        indicator._panelProgressPosition = indicator._seekPosition;
        indicator._updatePanelProgressFill(
            indicator._panelProgressPosition,
            indicator._seekLength || 0,
        );
        indicator.seekOverlay.updateProgress(
            indicator._seekPosition,
            indicator._seekLength || 0,
        );
        this.syncSeekWidth();

        this.resetSeekHideTimer();

        // At the beginning of a seek session the local position is unknown.
        // Query the actual player position asynchronously and correct the base.
        if (indicator._seekPositionUnknown) {
            indicator._seekPositionUnknown = false;
            this.syncSeekPosition(indicator._currentPlayerAddress);
        }
    }

    /** Switches from the track label to the seek overlay with a crossfade. */
    enterSeekMode() {
        const indicator = this._indicator;
        indicator._seekActive = true;
        indicator._seekPositionUnknown = true;
        indicator._seekPosition = 0;

        indicator.seekOverlay.setColors(
            indicator._palette ? indicator._palette.background : null,
            indicator._palette ? indicator._palette.text : null,
        );

        indicator.trackLabel.remove_transition("opacity");
        indicator.trackLabel.ease({
            opacity: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        indicator.seekOverlay.opacity = 0;
        indicator.seekOverlay.visible = true;
        indicator.seekOverlay.remove_all_transitions();
        indicator.seekOverlay.ease({
            opacity: 255,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    /** Returns from the seek overlay to the track label with a crossfade. */
    exitSeekMode() {
        const indicator = this._indicator;
        if (!indicator._seekActive) return;
        indicator._seekActive = false;
        indicator._pollPanelProgress();

        indicator.trackLabel.restoreNaturalWidth();

        indicator.seekOverlay.remove_all_transitions();
        indicator.seekOverlay.ease({
            opacity: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!indicator._isDestroyed) indicator.seekOverlay.visible = false;
            },
        });

        indicator.trackLabel.remove_transition("opacity");
        indicator.trackLabel.ease({
            opacity: 255,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    /** Resets the seek session immediately when the active player or track changes. */
    resetSeekState() {
        const indicator = this._indicator;
        if (indicator._seekHideTimeoutId) {
            GLib.source_remove(indicator._seekHideTimeoutId);
            indicator._seekHideTimeoutId = null;
        }
        indicator._seekActive = false;
        indicator._seekPositionUnknown = true;
        indicator._seekPosition = 0;

        if (indicator.seekOverlay) {
            indicator.seekOverlay.remove_all_transitions();
            indicator.seekOverlay.opacity = 0;
            indicator.seekOverlay.visible = false;
        }
        if (indicator.trackLabel) {
            indicator.trackLabel.remove_all_transitions();
            indicator.trackLabel.opacity = 255;
            indicator.trackLabel.set_width(-1);
        }
    }

    /** Keeps the panel button wide enough for the current timecode. */
    syncSeekWidth() {
        const indicator = this._indicator;
        if (indicator._isDestroyed || !indicator.seekOverlay || !indicator.trackLabel)
            return;
        indicator.trackLabel.growToFit(indicator.seekOverlay.getRequiredWidth());
    }

    /** Restarts the auto-hide timer for the seek timecode. */
    resetSeekHideTimer() {
        const indicator = this._indicator;
        if (indicator._seekHideTimeoutId) {
            GLib.source_remove(indicator._seekHideTimeoutId);
        }
        const hideDelayMs = indicator._settings.get_int("seek-timecode-duration");
        indicator._seekHideTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            hideDelayMs,
            () => {
                indicator._seekHideTimeoutId = null;
                this.exitSeekMode();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    /** Queries MPRIS Position directly because Position is not signalled continuously. */
    async syncSeekPosition(address) {
        const indicator = this._indicator;
        try {
            const result = await Gio.DBus.session.call(
                address,
                "/org/mpris/MediaPlayer2",
                "org.freedesktop.DBus.Properties",
                "Get",
                new GLib.Variant("(ss)", [
                    "org.mpris.MediaPlayer2.Player",
                    "Position",
                ]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
            );

            if (
                indicator._isDestroyed ||
                !indicator._seekActive ||
                indicator._currentPlayerAddress !== address
            )
                return;

            if (result) {
                const [variant] = result.recursiveUnpack();
                indicator._seekPosition = Number(variant) || 0;
                indicator._panelProgressPosition = indicator._seekPosition;
                indicator._updatePanelProgressFill(
                    indicator._panelProgressPosition,
                    indicator._seekLength,
                );
                indicator.seekOverlay.updateProgress(
                    indicator._seekPosition,
                    indicator._seekLength || 0,
                );
                this.syncSeekWidth();
            }
        } catch (e) {
            // Some players do not expose Position; retain the locally calculated position.
            log(`MPRIS Position query error: ${e.message}`);
        }
    }
}
