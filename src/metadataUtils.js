/**
 * Pure helpers for normalizing the metadata fields used by the indicator.
 * Preserve the previous inline behavior so this extraction does not alter UI logic.
 */
export function buildTrackKey(metadata = {}) {
    const artists = metadata["xesam:artist"];
    return JSON.stringify({
        id: String(metadata["mpris:trackid"] ?? ""),
        title: String(metadata["xesam:title"] ?? ""),
        artists: Array.isArray(artists)
            ? artists.map(String)
            : [String(artists ?? "")],
        album: String(metadata["xesam:album"] ?? ""),
    });
}

export function getTrackLength(metadata = {}) {
    return Number(metadata["mpris:length"]) || 0;
}

export function getArtworkUrl(metadata = {}) {
    return metadata["mpris:artUrl"] || "";
}
