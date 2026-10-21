import GLib from "gi://GLib";

export class ProgressController {
    constructor(indicator) {
        this._indicator = indicator;
    }

    async pollPanelProgress() {
        const indicator = this._indicator;
        if (
            indicator._isDestroyed ||
            indicator._seekActive ||
            !indicator._currentPlayerAddress ||
            !indicator._playerManager ||
            indicator._panelProgressPollInFlight
        )
            return;

        const address = indicator._currentPlayerAddress;
        indicator._panelProgressPollInFlight = true;
        try {
            const position =
                await indicator._playerManager.getPosition(address);
            if (
                indicator._isDestroyed ||
                address !== indicator._currentPlayerAddress ||
                indicator._seekActive ||
                position === null
            )
                return;

            indicator._panelProgressPosition = Math.max(
                0,
                Number(position) || 0,
            );
            indicator._updatePanelProgressFill(
                indicator._panelProgressPosition,
                indicator._seekLength,
            );
        } finally {
            indicator._panelProgressPollInFlight = false;
        }
    }

    startPanelProgressPolling() {
        const indicator = this._indicator;
        if (indicator._isDestroyed || indicator._panelProgressTimeoutId) return;
        this.pollPanelProgress();
        indicator._panelProgressTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            100,
            () => {
                if (
                    indicator._isDestroyed ||
                    !indicator._currentPlayerAddress ||
                    !indicator._playerProxy ||
                    indicator._playerProxy.PlaybackStatus !== "Playing"
                ) {
                    indicator._panelProgressTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                }
                this.pollPanelProgress();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    stopPanelProgressPolling() {
        const indicator = this._indicator;
        if (indicator._panelProgressTimeoutId) {
            GLib.source_remove(indicator._panelProgressTimeoutId);
            indicator._panelProgressTimeoutId = null;
        }
    }

    async pollDetailedProgress() {
        const indicator = this._indicator;
        if (indicator._isDestroyed || !indicator._detailedWindow) return;
        if (indicator._seekActive) return;
        if (!indicator._currentPlayerAddress) return;

        const position = await indicator._playerManager.getPosition(
            indicator._currentPlayerAddress,
        );
        if (indicator._isDestroyed || !indicator._detailedWindow) return;
        if (position === null) return;

        indicator._detailedWindow.updateProgress(
            position,
            indicator._seekLength || 0,
        );
    }

    setDetailedProgressPolling(isOpen) {
        const indicator = this._indicator;
        if (isOpen) {
            this.pollDetailedProgress();
            if (!indicator._detailedProgressTimeoutId) {
                indicator._detailedProgressTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    1000,
                    () => {
                        this.pollDetailedProgress();
                        return GLib.SOURCE_CONTINUE;
                    },
                );
            }
        } else {
            this.stopDetailedProgressPolling();
        }
    }

    stopDetailedProgressPolling() {
        const indicator = this._indicator;
        if (indicator._detailedProgressTimeoutId) {
            GLib.source_remove(indicator._detailedProgressTimeoutId);
            indicator._detailedProgressTimeoutId = null;
        }
    }
}
