export function buildArtworkCandidates(artUrl) {
    const candidates = [];
    const addCandidate = (url) => {
        if (url && !candidates.includes(url)) candidates.push(url);
    };

    let isYouTubeThumbnail = false;
    const youtubeMatch = artUrl.match(
        /^(https?:\/\/(?:i\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/[^/]+\/)([^/?#]+)(\.(?:jpg|jpeg|png|webp))(?:[?#].*)?$/i,
    );

    if (youtubeMatch) {
        isYouTubeThumbnail = true;
        const prefix = youtubeMatch[1];
        const extension = youtubeMatch[3];
        addCandidate(`${prefix}maxresdefault${extension}`);
        addCandidate(`${prefix}sddefault${extension}`);
        addCandidate(`${prefix}hqdefault${extension}`);
        addCandidate(`${prefix}mqdefault${extension}`);
        addCandidate(`${prefix}default${extension}`);
    }

    const tmdbMatch = artUrl.match(
        /^(https?:\/\/image\.tmdb\.org\/t\/p\/)([^/]+)(\/[^?#]+)([?#].*)?$/i,
    );
    if (tmdbMatch) {
        const base = tmdbMatch[1];
        const path = tmdbMatch[3];
        const query = tmdbMatch[4] || "";
        for (const size of [
            "w185",
            "w342",
            "w500",
            "w780",
            "w1280",
            "original",
        ])
            addCandidate(`${base}${size}${path}${query}`);
    }

    const googleHost =
        /^https?:\/\/(?:yt3\.ggpht\.com|lh\d+\.googleusercontent\.com)\//i.test(
            artUrl,
        );
    if (googleHost) {
        const suffixMatch = artUrl.match(
            /^(https?:\/\/[^?#]+?)(?:=w\d+-h\d+[^/?#]*|=s\d+[^/?#]*)([?#].*)?$/i,
        );
        if (suffixMatch) {
            const base = suffixMatch[1];
            const query = suffixMatch[2] || "";
            addCandidate(`${base}=w1600-h1600${query}`);
            addCandidate(`${base}=w1200-h1200${query}`);
            addCandidate(`${base}=w800-h800${query}`);
        }
    }

    addCandidate(artUrl);
    return {
        candidates,
        isYouTubeThumbnail,
        isTmdbArtwork: Boolean(tmdbMatch),
    };
}

export function fitArtworkToScreen(
    width,
    height,
    stageWidth,
    stageHeight,
    margin = 50,
) {
    const maxWidth = Math.max(1, stageWidth - margin * 2);
    const maxHeight = Math.max(1, stageHeight - margin * 2);
    const scale = Math.min(maxWidth / width, maxHeight / height);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

export function isArtworkResolutionEnough(
    width,
    height,
    displaySize,
    oversampling = 1.05,
) {
    return (
        width >= Math.ceil(displaySize.width * oversampling) &&
        height >= Math.ceil(displaySize.height * oversampling)
    );
}

export function getRequiredSourceWidth(
    width,
    height,
    displaySize,
    oversampling = 1.05,
) {
    const requiredWidth = Math.ceil(displaySize.width * oversampling);
    const requiredHeight = Math.ceil(displaySize.height * oversampling);
    return Math.ceil(
        width * Math.max(requiredWidth / width, requiredHeight / height),
    );
}

export function findNextSuitableTmdbCandidate(
    candidates,
    currentIndex,
    neededSourceWidth,
) {
    return candidates.findIndex((url, candidateIndex) => {
        if (candidateIndex <= currentIndex) return false;
        const sizeMatch = url.match(/\/t\/p\/w(\d+)\//i);
        if (sizeMatch) return Number(sizeMatch[1]) >= neededSourceWidth;
        return /\/t\/p\/original\//i.test(url);
    });
}

export function getYouTubeMinimumWidth(candidate) {
    if (candidate.includes("/maxresdefault.")) return 800;
    if (candidate.includes("/sddefault.")) return 500;
    if (candidate.includes("/hqdefault.")) return 320;
    if (candidate.includes("/mqdefault.")) return 200;
    return 1;
}

export function escapeCssUrl(url) {
    return url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
