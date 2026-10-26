const IGNORED_TOKENS = new Set([
    "org",
    "com",
    "net",
    "io",
    "app",
    "desktop",
    "media",
    "player",
    "client",
    "application",
    "the",
    "instance",
    "unknown",
]);

function normalizeIdentifier(value) {
    return String(value ?? "")
        .replace(/\.desktop$/i, "")
        .replace(/\.instance(?:[._-].*)?$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function identifierTokens(value) {
    return String(value ?? "")
        .replace(/\.desktop$/i, "")
        .replace(/\.instance(?:[._-].*)?$/i, "")
        .split(/[._\-\s]+/)
        .map((part) => part.toLowerCase().replace(/[^a-z0-9]/g, ""))
        .filter((part) => part.length >= 3 && !IGNORED_TOKENS.has(part));
}

export function matchesFocusedApplication(focusedAppId, playerAddress, identity = "") {
    const focusedId = normalizeIdentifier(focusedAppId);
    if (!focusedId) return false;

    const focusedTokens = new Set(identifierTokens(focusedAppId));
    const serviceName = String(playerAddress ?? "").replace(
        /^org\.mpris\.MediaPlayer2\./i,
        "",
    );

    return [serviceName, identity].some((candidate) => {
        const candidateId = normalizeIdentifier(candidate);
        if (candidateId && candidateId === focusedId) return true;

        return identifierTokens(candidate).some((token) =>
            focusedTokens.has(token),
        );
    });
}
