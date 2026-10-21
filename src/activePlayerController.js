export function setActivePlayer(address, proxy) {
    if (this._isDestroyed) return;

    if (this._currentPlayerAddress !== address) {
        this._resetSeekState();
        this._panelProgressPosition = 0;
        this._currentTrackKey = null;
    }

    this._currentPlayerAddress = address;
    this._playerProxy = proxy;

    this._updateMetadata();
    this._updateVisibility();
    if (proxy.PlaybackStatus === "Playing") {
        this._startPanelProgressPolling();
    } else {
        this._stopPanelProgressPolling();
        this._pollPanelProgress();
    }
}

export function clearActivePlayer() {
    if (this._isDestroyed) return;

    this._resetSeekState();
    this._currentPlayerAddress = null;
    this._playerProxy = null;
    this._currentArtUrl = null;
    this._currentTrackKey = null;
    this._stopPanelProgressPolling();
    this._panelProgressPosition = 0;
    this._seekLength = 0;
    this._updatePanelProgressFill(0, 0);

    this._updateVisibility();
    if (this.albumArt && this.albumArt.updateArt) {
        this.albumArt.updateArt(null, this._settings.get_int("album-radius"));
    }
}

export function updateVisibility() {
    if (!this._playerProxy || !this._currentPlayerAddress) {
        this.visible = false;
        return;
    }

    try {
        const playbackStatus = this._playerProxy.PlaybackStatus;
        const isActive =
            playbackStatus === "Playing" || playbackStatus === "Paused";

        const appId = this._playerManager.getAppIdentifier(
            this._currentPlayerAddress,
        );
        const players = JSON.parse(this._settings.get_string("media-players"));

        const config = players[appId];
        const isAllowed = config ? config.visible : true;

        this.visible = isActive && isAllowed;
    } catch (e) {
        this.visible = false;
    }
}
