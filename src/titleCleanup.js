// Чиста логіка "розумного" очищення назв треків від службових позначок
// (Remastered, Remix, Live тощо). Без залежностей від GNOME Shell — легко
// тестувати ізольовано і перевикористовувати деінде.
//
// Ідея: службова позначка майже завжди приходить в одній з трьох форм:
//   "Title (Remastered)"        — у круглих дужках
//   "Title [Remastered]"        — у квадратних дужках
//   "Title - Remastered"        — після дефіса/тире-роздільника в кінці
// ...і часто разом з роком випуску ремастера:
//   "Title (2024 Remaster)"     "Title [2024 Remastered]"
//   "Title - 2024 Remaster"
//
// Тому фільтр видаляє не саме слово, а весь фрагмент — дужки/роздільник
// разом із опційним роком.

/**
 * Екранує спецсимволи регулярних виразів, щоб довільний рядок,
 * введений користувачем, можна було безпечно підставити в шаблон.
 */
export function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Заздалегідь задані пресети. Кожен елемент — фрагмент регулярного виразу
// (без екранування, бо навмисно містить альтернативи на кшталт "ed?"),
// що описує одне службове поняття в усіх його типових формах запису.
const LIGHT_WORDS = [
    'Remaster(?:ed)?',
    'Digital Remaster(?:ed)?',
];

const STANDARD_WORDS = [
    ...LIGHT_WORDS,
    'Remix(?:ed)?',
    'Live(?: Version)?',
    'Mono(?: Version)?',
    'Stereo(?: Version)?',
    'Radio Edit',
    'Single Version',
    'Album Version',
    'Bonus Track',
    'Digital Remaster(?:ed)?',
];

const AGGRESSIVE_WORDS = [
    ...STANDARD_WORDS,
    'Deluxe(?: Edition)?',
    'Digital Remaster(?:ed)?',
    'Explicit',
    'Clean(?: Version)?',
    'Extended(?: Mix)?',
    'Acoustic(?: Version)?',
    'Demo(?: Version)?',
    'Single(?: Edit)?',
    'Original Mix',
    'Anniversary Edition',
    'Special Edition',
    'Expanded Edition',
    'Extended Version',
    'Instrumental',
    'Karaoke Version',
    'HD',
    '4K',
];

export const TITLE_CLEANUP_PRESETS = {
    light: LIGHT_WORDS,
    standard: STANDARD_WORDS,
    aggressive: AGGRESSIVE_WORDS,
};

// Порядок і підписи пресетів для UI (prefs.js). "custom" — особливий
// випадок: список слів задає сам користувач, а не код.
export const TITLE_CLEANUP_PRESET_ORDER = ['off', 'light', 'standard', 'aggressive', 'custom'];

/**
 * Будує єдиний регулярний вираз, що знаходить службовий фрагмент разом з
 * дужками/роздільником та опційним роком, у будь-якій з трьох форм.
 *
 * @param {string[]} wordPatterns - фрагменти регексу (для пресетів) або вже
 *   заекрановані літерали (для власного списку користувача).
 */
function buildCleanupRegex(wordPatterns) {
    const alt = wordPatterns.join('|');
    const YEAR = '(?:19|20)\\d{2}';

    // Службове слово, до і/або після якого може стояти рік випуску
    // ремастера/перевидання: "2024 Remaster" або "Remastered 2024".
    const inner = `\\s*(?:${YEAR}\\s+)?(?:${alt})(?:\\s+${YEAR})?\\s*`;

    // Форма 1 і 2: весь вміст дужок (круглих або квадратних).
    const bracketForm = `[\\(\\[]${inner}[\\)\\]]`;

    // Форма 3: усе від дефіса/тире-роздільника до кінця назви.
    const dashForm = `[-\u2013\u2014]${inner}$`;

    return new RegExp(`\\s*(?:${bracketForm}|${dashForm})`, 'gi');
}

/**
 * Вилучає з назви треку всі службові фрагменти, що відповідають переданому
 * переліку слів/фраз, разом з дужками чи роздільником, у якому вони стоять.
 *
 * @param {string} title - вихідна назва треку.
 * @param {string[]} wordPatterns - фрагменти регексу для пошуку.
 * @returns {string} очищена назва (або вихідна, якщо після очищення
 *   нічого б не залишилось — краще показати "зайве", ніж порожній рядок).
 */
export function cleanTrackTitle(title, wordPatterns) {
    if (!title || !Array.isArray(wordPatterns) || wordPatterns.length === 0)
        return title;

    const regex = buildCleanupRegex(wordPatterns);

    let result = title.replace(regex, '');
    result = result.replace(/\s{2,}/g, ' ').trim();
    // Прибираємо "осиротілий" роздільник, що міг лишитись у кінці,
    // якщо службовий фрагмент був не останнім елементом дужок.
    result = result.replace(/[-\u2013\u2014\s]+$/, '').trim();

    return result.length > 0 ? result : title;
}

/**
 * Готує список фрагментів регексу для конкретного налаштування пресету.
 * Для "off" — порожній список (нічого не чиститься). Для "custom" —
 * заекрановані літерали слів, введених користувачем.
 *
 * @param {string} preset - один з TITLE_CLEANUP_PRESET_ORDER.
 * @param {string[]} customWords - список слів користувача (лише для "custom").
 */
export function getCleanupWordsForPreset(preset, customWords) {
    if (preset === 'custom') {
        return (customWords || [])
            .map((w) => escapeRegExp(String(w).trim()))
            .filter(Boolean);
    }

    return TITLE_CLEANUP_PRESETS[preset] || [];
}
