export function applyCustomStyles(DisplayMode) {
    if (this._isDestroyed || !this._settings || !this.layout) return;

    const autoColor = this._settings.get_boolean("auto-color");
    const intensity = this._settings.get_int("color-intensity") / 100;
    const radius = this._settings.get_int("album-radius");
    const pLeft = this._settings.get_int("padding-left");
    const pRight = this._settings.get_int("padding-right");
    const maxWidth = this._settings.get_int("button-width");
    const displayMode = this._settings.get_int("display-mode");
    const hasArt = !!(this.albumArt && this.albumArt._avgColor);

    const effectiveDisplayMode = hasArt ? displayMode : DisplayMode.TEXT;

    this.albumArt.visible =
        effectiveDisplayMode === DisplayMode.ART ||
        effectiveDisplayMode === DisplayMode.BOTH;
    this._trackStack.visible =
        effectiveDisplayMode === DisplayMode.TEXT ||
        effectiveDisplayMode === DisplayMode.BOTH;

    this._currentRadius = radius;
    this._currentIntensity = intensity;

    const shouldUseAdaptivePalette =
        autoColor && hasArt && effectiveDisplayMode !== DisplayMode.TEXT;

    this._useThemeColors = !shouldUseAdaptivePalette;

    this._useThemeButtonAppearance = effectiveDisplayMode === DisplayMode.TEXT;
    if (this._useThemeButtonAppearance) {
        this.remove_style_class_name("mpris-indicator-main-button");
    } else {
        this.add_style_class_name("mpris-indicator-main-button");
        this.remove_style_pseudo_class("hover");
        this.remove_style_pseudo_class("active");
    }

    this._palette = shouldUseAdaptivePalette
        ? this._paletteManager.generatePalette(
              this.albumArt._avgColor,
              intensity,
          )
        : null;

    this.trackLabel.applyTextColor(this._palette ? this._palette.text : null);

    this._updateBackground();

    this.trackLabel.applyWidth(maxWidth);

    if (this._seekActive) {
        this.seekOverlay.setColors(
            this._palette ? this._palette.background : null,
            this._palette ? this._palette.text : null,
        );
    }

    let cssPaddingLeft = 0;
    let cssPaddingRight = 0;
    let cssSpacing = 0;

    if (effectiveDisplayMode === DisplayMode.BOTH) {
        cssPaddingLeft = 0;
        cssSpacing = pLeft;
        cssPaddingRight = pRight;
    } else if (effectiveDisplayMode === DisplayMode.TEXT) {
        cssPaddingLeft = pLeft;
        cssSpacing = 0;
        cssPaddingRight = pRight;
    } else if (effectiveDisplayMode === DisplayMode.ART) {
        cssPaddingLeft = 0;
        cssSpacing = 0;
        cssPaddingRight = 0;
    }

    this.layout.set_style(`
                padding-left: ${cssPaddingLeft}px;
                padding-right: ${cssPaddingRight}px;
                spacing: ${cssSpacing}px;
            `);

    if (this.albumArt) {
        this.albumArt._radius = radius;
        this.albumArt.queue_repaint();
    }
    this._updatePanelProgressGeometry();
}

export function updateBackground() {
    if (this._useThemeButtonAppearance) {
        this.set_style(`
                    -natural-hpadding: 0px;
                    -minimum-hpadding: 0px;
                `);
        return;
    }

    const radius = this._currentRadius ?? 0;
    const intensity = this._currentIntensity ?? 1;

    let bgColor = "transparent";

    if (this._useThemeColors) {
        const theme = this._paletteManager.getThemeButtonColors();
        const state =
            this._visualState === "pressed"
                ? theme.pressed
                : this._visualState === "hover"
                  ? theme.hover
                  : theme.normal;

        bgColor = `rgba(${state.r}, ${state.g}, ${state.b}, ${state.a})`;
    } else if (this._palette) {
        const rgb =
            this._visualState === "pressed"
                ? this._palette.pressed
                : this._visualState === "hover"
                  ? this._palette.hover
                  : this._palette.background;

        bgColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity})`;
    }

    this.set_style(`
                background-color: ${bgColor};
                border-radius: ${radius}px;
                -natural-hpadding: 0px;
                -minimum-hpadding: 0px;
                padding: 0px;
            `);
}

export function syncThemeButtonPseudoClasses() {
    if (!this._useThemeButtonAppearance) return;

    this.remove_style_pseudo_class("hover");
    this.remove_style_pseudo_class("active");

    if (this._visualState === "hover") {
        this.add_style_pseudo_class("hover");
    } else if (this._visualState === "pressed") {
        this.add_style_pseudo_class("hover");
        this.add_style_pseudo_class("active");
    }
}
