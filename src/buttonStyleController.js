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

            // Якщо в метаданих немає обкладинки, примусово показуємо лише
            // текст незалежно від обраного режиму (ART/BOTH/TEXT).
            const effectiveDisplayMode = hasArt
                ? displayMode
                : DisplayMode.TEXT;

            // Режим відображення керує тим, які з двох елементів (обкладинка,
            // текст) взагалі вставлені в layout кнопки. Невидимі актори
            // St.BoxLayout не отримують місця під час алокації, тож spacing
            // між ними автоматично не залишає зайвої порожнечі.
            this.albumArt.visible =
                effectiveDisplayMode === DisplayMode.ART ||
                effectiveDisplayMode === DisplayMode.BOTH;
            this._trackStack.visible =
                effectiveDisplayMode === DisplayMode.TEXT ||
                effectiveDisplayMode === DisplayMode.BOTH;

            // Палітра (фон/hover/pressed/текст) рахується один раз тут і
            // кешується в this._palette — саме її потім використовує
            // _updateBackground() при зміні hover/pressed стану кнопки,
            // щоб не перераховувати HSL на кожен enter/leave/press.
            this._currentRadius = radius;
            this._currentIntensity = intensity;

            // Кольори з обкладинки використовуються лише тоді, коли
            // вимкнений режим "Адаптивний колір" і є реальна обкладинка.
            // В іншому випадку кнопка має виглядати як звичайна кнопка
            // панелі: фон береться з теми оболонки, а не стає прозорим.
            const shouldUseAdaptivePalette =
                autoColor &&
                hasArt &&
                effectiveDisplayMode !== DisplayMode.TEXT;

            this._useThemeColors = !shouldUseAdaptivePalette;

            // Коли показується лише текст (зокрема, трек не має обкладинки),
            // не відтворюємо частину стилів теми вручну. Повертаємо кнопці
            // штатний вигляд .panel-button цілком: color, border, radius,
            // background і text-shadow для normal/hover/active.
            this._useThemeButtonAppearance =
                effectiveDisplayMode === DisplayMode.TEXT;
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

            this.trackLabel.applyTextColor(
                this._palette ? this._palette.text : null,
            );

            this._updateBackground();

            this.trackLabel.applyWidth(maxWidth);

            if (this._seekActive) {
                this.seekOverlay.setColors(
                    this._palette ? this._palette.background : null,
                    this._palette ? this._palette.text : null,
                );
            }

            // Динамічний розрахунок відступів залежно від режиму
            let cssPaddingLeft = 0;
            let cssPaddingRight = 0;
            let cssSpacing = 0;

            if (effectiveDisplayMode === DisplayMode.BOTH) {
                // Обкладинка притиснута ліворуч, pLeft - це відстань між нею та текстом
                cssPaddingLeft = 0;
                cssSpacing = pLeft;
                cssPaddingRight = pRight;
            } else if (effectiveDisplayMode === DisplayMode.TEXT) {
                // Відступ зліва стає повноцінним padding-left для тексту
                cssPaddingLeft = pLeft;
                cssSpacing = 0;
                cssPaddingRight = pRight;
            } else if (effectiveDisplayMode === DisplayMode.ART) {
                // Якщо тільки обкладинка, прибираємо зайві відступи контейнера
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
                // Колір/фон/border мають успадковуватись безпосередньо з
                // .panel-button активної теми оболонки (через псевдокласи
                // hover/active), тож тут вони не задаються. Але власний
                // -natural-hpadding теми (típ. 10px) скасовуємо примусово:
                // бокові відступи в режимі "Тільки текст" повністю задає
                // користувач через padding-left/padding-right у налаштуваннях.
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
                // Без обкладинки (або в режимі "Текст") кнопка бере кольори
                // напряму з теми оболонки (.panel-button), як є — без
                // урахування "Адаптивний колір"/інтенсивності.
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
