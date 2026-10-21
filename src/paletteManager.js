import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
    clamp01,
    rgbToHsl,
    hslToRgb,
    relativeLuminance,
    contrastRatio,
    blendOverPanel,
} from "./colorUtils.js";

export class PaletteManager {
    constructor() {
        this._themeButtonColors = null;
        this._cachedPanelBgColor = null;
    }

    resetThemeCache() {
        this._themeButtonColors = null;
        this._cachedPanelBgColor = null;
    }

    getThemeButtonColors() {
        if (this._themeButtonColors) return this._themeButtonColors;

        const fallback = { r: 0, g: 0, b: 0, a: 0 };
        let colors = { normal: fallback, hover: fallback, pressed: fallback };
        let probe = null;

        try {
            probe = new St.Widget({
                style_class: "panel-button",
                reactive: false,
                opacity: 0,
            });
            Main.layoutManager.uiGroup.add_child(probe);

            const readState = (pseudoClass) => {
                if (pseudoClass) probe.add_style_pseudo_class(pseudoClass);
                probe.ensure_style();
                const bg = probe.get_theme_node().get_background_color();
                if (pseudoClass) probe.remove_style_pseudo_class(pseudoClass);
                return {
                    r: bg.red,
                    g: bg.green,
                    b: bg.blue,
                    a: bg.alpha / 255,
                };
            };

            colors = {
                normal: readState(null),
                hover: readState("hover"),
                pressed: readState("active"),
            };
        } catch (e) {
        } finally {
            if (probe) probe.destroy();
        }

        this._themeButtonColors = colors;
        return this._themeButtonColors;
    }

    getPanelBackgroundColor() {
        if (this._cachedPanelBgColor) return this._cachedPanelBgColor;

        let bg = { r: 30, g: 30, b: 30 };

        try {
            const themeNode = Main.panel.get_theme_node();
            const bgColor = themeNode.get_background_color();

            if (bgColor.alpha > 10) {
                bg = { r: bgColor.red, g: bgColor.green, b: bgColor.blue };
            } else {
                const fgColor = themeNode.get_foreground_color();
                const fgLuminance = relativeLuminance({
                    r: fgColor.red,
                    g: fgColor.green,
                    b: fgColor.blue,
                });
                bg =
                    fgLuminance > 0.5
                        ? { r: 30, g: 30, b: 30 }
                        : { r: 245, g: 245, b: 245 };
            }
        } catch (e) {}

        this._cachedPanelBgColor = bg;
        return bg;
    }

    generatePalette(avgColor, intensity) {
        const hsl = rgbToHsl(avgColor);

        const hover = hslToRgb(
            hsl.h,
            clamp01(hsl.s + 0.06),
            clamp01(hsl.l + 0.07),
        );
        const pressed = hslToRgb(
            hsl.h,
            clamp01(hsl.s - 0.15),
            clamp01(hsl.l - 0.14),
        );

        const darkText = hslToRgb(hsl.h, clamp01(hsl.s + 0.03), 0.12);
        const lightText = hslToRgb(hsl.h, clamp01(hsl.s - 0.35), 0.93);

        const panelBg = this.getPanelBackgroundColor();
        const blendedBg = blendOverPanel(avgColor, intensity, panelBg);
        const bgLuminance = relativeLuminance(blendedBg);

        const darkContrast = contrastRatio(
            bgLuminance,
            relativeLuminance(darkText),
        );
        const lightContrast = contrastRatio(
            bgLuminance,
            relativeLuminance(lightText),
        );
        const text = darkContrast >= lightContrast ? darkText : lightText;

        return { background: avgColor, hover, pressed, text };
    }
}
