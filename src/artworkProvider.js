import Gio from "gi://Gio";
import GLib from "gi://GLib";

const LAMPA_PLAYER_PREFIX = "org.mpris.MediaPlayer2.chromium";
const LAMPA_TEMP_ART_RE = /^file:\/\/\/tmp\/\.io\.nwjs\./i;
const TMDB_URL_RE =
    /^https:\/\/image\.tmdb\.org\/t\/p\/(?:original|w\d+)\/[^?#]+(?:[?#].*)?$/i;

function isLampaArtwork(indicator, mprisArtUrl) {
    return (
        String(indicator?._currentPlayerAddress || "").startsWith(
            LAMPA_PLAYER_PREFIX,
        ) && LAMPA_TEMP_ART_RE.test(mprisArtUrl || "")
    );
}

export function resolvePreviewArtworkUrl(indicator, mprisArtUrl, onResolved) {
    const finish = (url) => {
        try {
            onResolved(url || mprisArtUrl);
        } catch (e) {
            log(`Media Label: preview callback failed: ${e.message}`);
        }
    };

    if (!isLampaArtwork(indicator, mprisArtUrl)) {
        finish(mprisArtUrl);
        return;
    }

    const posterPath = GLib.build_filenamev([
        GLib.get_home_dir(),
        "bin",
        "LampaUncensoredLinux",
        "lampa-poster-url.txt",
    ]);

    try {
        const posterFile = Gio.File.new_for_path(posterPath);
        posterFile.load_contents_async(null, (file, result) => {
            let previewUrl = mprisArtUrl;
            try {
                const [success, contents] = file.load_contents_finish(result);
                if (success && contents) {
                    const candidate = new TextDecoder("utf-8")
                        .decode(contents)
                        .trim();
                    if (TMDB_URL_RE.test(candidate)) {
                        previewUrl = candidate.replace(
                            /\/t\/p\/(?:original|w\d+)\//i,
                            "/t/p/original/",
                        );
                    }
                }
            } catch (e) {
                log(
                    `Media Label: could not read Lampa poster URL: ${e.message}`,
                );
            }
            finish(previewUrl);
        });
    } catch (e) {
        log(`Media Label: could not open Lampa poster URL file: ${e.message}`);
        finish(mprisArtUrl);
    }
}
