import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    clamp01, rgbToHsl, hslToRgb, relativeLuminance, contrastRatio, blendOverPanel,
} from './colorUtils.js';

/**
 * Відповідає за все, що пов'язано з кольором кнопки:
 *  - читання реальних кольорів теми оболонки (.panel-button) через
 *    прихований probe-віджет;
 *  - визначення фактичного фону панелі (для коректного alpha-blending);
 *  - генерацію адаптивної палітри (фон/hover/pressed/текст) з середнього
 *    кольору обкладинки.
 *
 * Кеші (кольори теми, фон панелі) тримаються всередині й скидаються
 * ззовні через resetThemeCache() при зміні теми оболонки.
 */
export class PaletteManager {
    constructor() {
        this._themeButtonColors = null;
        this._cachedPanelBgColor = null;
    }

    resetThemeCache() {
        this._themeButtonColors = null;
        this._cachedPanelBgColor = null;
    }

    /**
     * Читає кольори теми оболонки для класу ".panel-button"
     * (normal / :hover / :active) через тимчасовий невидимий probe-віджет:
     * стилі St обчислюються лише для акторів у дереві сцени, тому
     * тимчасово додаємо невидимий (opacity: 0) віджет з потрібним
     * style_class, перемикаємо на ньому pseudo-class і читаємо
     * get_theme_node().get_background_color().
     */
    getThemeButtonColors() {
        if (this._themeButtonColors) return this._themeButtonColors;

        const fallback = { r: 0, g: 0, b: 0, a: 0 };
        let colors = { normal: fallback, hover: fallback, pressed: fallback };
        let probe = null;

        try {
            probe = new St.Widget({
                style_class: 'panel-button',
                reactive: false,
                opacity: 0,
            });
            Main.layoutManager.uiGroup.add_child(probe);

            const readState = (pseudoClass) => {
                if (pseudoClass) probe.add_style_pseudo_class(pseudoClass);
                probe.ensure_style();
                const bg = probe.get_theme_node().get_background_color();
                if (pseudoClass) probe.remove_style_pseudo_class(pseudoClass);
                return { r: bg.red, g: bg.green, b: bg.blue, a: bg.alpha / 255 };
            };

            colors = {
                normal: readState(null),
                hover: readState('hover'),
                pressed: readState('active'),
            };
        } catch (e) {
            // лишаємо прозорий безпечний дефолт
        } finally {
            if (probe) probe.destroy();
        }

        this._themeButtonColors = colors;
        return this._themeButtonColors;
    }

    /**
     * Визначає реальний фон панелі GNOME Shell (позаду кнопки), потрібний
     * для коректного змішування напівпрозорого кольору обкладинки.
     * Кешується, бо readback теми — відносно недешева операція, а сам
     * фон панелі змінюється лише разом зі зміною теми.
     */
    getPanelBackgroundColor() {
        if (this._cachedPanelBgColor) return this._cachedPanelBgColor;

        let bg = { r: 30, g: 30, b: 30 }; // безпечний дефолт: типова темна панель

        try {
            const themeNode = Main.panel.get_theme_node();
            const bgColor = themeNode.get_background_color();

            if (bgColor.alpha > 10) {
                // У панелі є власний (напів)непрозорий фон — використовуємо його напряму
                bg = { r: bgColor.red, g: bgColor.green, b: bgColor.blue };
            } else {
                // Фон панелі прозорий (тема малює його деінде, напр. на desktop-шарі) —
                // орієнтуємось на колір тексту теми: світлий текст означає темну тему.
                const fgColor = themeNode.get_foreground_color();
                const fgLuminance = relativeLuminance({
                    r: fgColor.red, g: fgColor.green, b: fgColor.blue,
                });
                bg = fgLuminance > 0.5
                    ? { r: 30, g: 30, b: 30 }
                    : { r: 245, g: 245, b: 245 };
            }
        } catch (e) {
            // лишаємо безпечний дефолт
        }

        this._cachedPanelBgColor = bg;
        return bg;
    }

    /**
     * Генерує повну адаптивну палітру кнопки з ОДНОГО кольору —
     * середнього кольору обкладинки. Приклад для #5A9BD5:
     *   background → сам колір обкладинки (як і раніше)
     *   hover      → трохи світліша й насиченіша версія
     *   pressed    → помітно темніша й приглушеніша версія
     *   text       → той самий відтінок (hue), але майже чорний або
     *                майже білий за lightness — обирається той із двох,
     *                що дає кращий WCAG-контраст із реальним видимим
     *                фоном (обкладинка, змішана з фоном панелі через
     *                intensity-прозорість кнопки).
     */
    generatePalette(avgColor, intensity) {
        const hsl = rgbToHsl(avgColor);

        const hover = hslToRgb(hsl.h, clamp01(hsl.s + 0.06), clamp01(hsl.l + 0.07));
        const pressed = hslToRgb(hsl.h, clamp01(hsl.s - 0.15), clamp01(hsl.l - 0.14));

        const darkText = hslToRgb(hsl.h, clamp01(hsl.s + 0.03), 0.12);
        const lightText = hslToRgb(hsl.h, clamp01(hsl.s - 0.35), 0.93);

        // Контраст рахуємо відносно реально видимого фону (обкладинка
        // змішана з фоном панелі через прозорість кнопки).
        const panelBg = this.getPanelBackgroundColor();
        const blendedBg = blendOverPanel(avgColor, intensity, panelBg);
        const bgLuminance = relativeLuminance(blendedBg);

        const darkContrast = contrastRatio(bgLuminance, relativeLuminance(darkText));
        const lightContrast = contrastRatio(bgLuminance, relativeLuminance(lightText));
        const text = darkContrast >= lightContrast ? darkText : lightText;

        return { background: avgColor, hover, pressed, text };
    }
}
