export function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LIGHT_WORDS = ["Remaster(?:ed)?", "Digital Remaster(?:ed)?"];

const STANDARD_WORDS = [
    ...LIGHT_WORDS,
    "Remix(?:ed)?",
    "Live(?: Version)?",
    "Mono(?: Version)?",
    "Stereo(?: Version)?",
    "Radio Edit",
    "Single Version",
    "Album Version",
    "Bonus Track",
    "Digital Remaster(?:ed)?",
];

const AGGRESSIVE_WORDS = [
    ...STANDARD_WORDS,
    "Deluxe(?: Edition)?",
    "Digital Remaster(?:ed)?",
    "Explicit",
    "Clean(?: Version)?",
    "Extended(?: Mix)?",
    "Acoustic(?: Version)?",
    "Demo(?: Version)?",
    "Single(?: Edit)?",
    "Original Mix",
    "Anniversary Edition",
    "Special Edition",
    "Expanded Edition",
    "Extended Version",
    "Instrumental",
    "Karaoke Version",
    "HD",
    "4K",
];

export const TITLE_CLEANUP_PRESETS = {
    light: LIGHT_WORDS,
    standard: STANDARD_WORDS,
    aggressive: AGGRESSIVE_WORDS,
};

export const TITLE_CLEANUP_PRESET_ORDER = [
    "off",
    "light",
    "standard",
    "aggressive",
    "custom",
];

function buildCleanupRegex(wordPatterns) {
    const alt = wordPatterns.join("|");
    const YEAR = "(?:19|20)\\d{2}";

    const inner = `\\s*(?:${YEAR}\\s+)?(?:${alt})(?:\\s+${YEAR})?\\s*`;

    const bracketForm = `[\\(\\[]${inner}[\\)\\]]`;

    const dashForm = `[-\u2013\u2014]${inner}$`;

    return new RegExp(`\\s*(?:${bracketForm}|${dashForm})`, "gi");
}

export function cleanTrackTitle(title, wordPatterns) {
    if (!title || !Array.isArray(wordPatterns) || wordPatterns.length === 0)
        return title;

    const regex = buildCleanupRegex(wordPatterns);

    let result = title.replace(regex, "");
    result = result.replace(/\s{2,}/g, " ").trim();
    result = result.replace(/[-\u2013\u2014\s]+$/, "").trim();

    return result.length > 0 ? result : title;
}

export function getCleanupWordsForPreset(preset, customWords) {
    if (preset === "custom") {
        return (customWords || [])
            .map((w) => escapeRegExp(String(w).trim()))
            .filter(Boolean);
    }

    return TITLE_CLEANUP_PRESETS[preset] || [];
}
