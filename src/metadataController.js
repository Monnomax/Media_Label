import {
    buildTrackKey,
    getArtworkUrl,
    getTrackLength,
} from "./metadataUtils.js";

export function updateMetadata() {
    if (!this._playerProxy) return;

    try {
        let metadataVariant = this._playerProxy.get_cached_property("Metadata");
        if (!metadataVariant && this._playerProxy.Metadata) {
            metadataVariant = this._playerProxy.Metadata;
        }

        if (!metadataVariant) {
            this.trackLabel.set_text("Очікування даних...");
            return;
        }

        let metadata = metadataVariant.recursiveUnpack
            ? metadataVariant.recursiveUnpack()
            : metadataVariant.deep_unpack();

        this.trackLabel.updateFromMetadata(metadata);

        const appId = this._playerManager.getAppIdentifier(
            this._currentPlayerAddress,
        );
        if (this._detailedWindow) {
            this._detailedWindow.updateInfo(metadata, appId);
        }

        const trackKey = buildTrackKey(metadata);

        if (
            this._currentTrackKey !== null &&
            trackKey !== this._currentTrackKey
        ) {
            this._resetSeekState();
            this._panelProgressPosition = 0;
        }
        this._currentTrackKey = trackKey;

        this._seekLength = getTrackLength(metadata);
        this._updatePanelProgressFill(
            this._panelProgressPosition,
            this._seekLength,
        );
        if (this._seekActive) {
            this.seekOverlay.updateProgress(
                this._seekPosition,
                this._seekLength,
            );
            this._syncSeekWidth();
        }

        const artUrl = getArtworkUrl(metadata);
        this._currentArtUrl = artUrl;
        const radius = this._settings.get_int("album-radius");

        if (this.albumArt && typeof this.albumArt.updateArt === "function") {
            this.albumArt.updateArt(artUrl, radius);
        }

        this._applyCustomStyles();
    } catch (e) {
        this.trackLabel.set_text(`Помилка: ${e.message}`);
        log(`MPRIS Metadata Error: ${e.message}`);
    }
}
