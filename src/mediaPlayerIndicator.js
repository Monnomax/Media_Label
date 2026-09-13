import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { TrackLabel } from "./textLabel.js";
import { CairoRoundedArt } from "./artLabel.js";
import { SeekOverlay } from "./seekOverlay.js";
import { DisplayMode } from "./constants.js";
import { PaletteManager } from "./paletteManager.js";
import { MprisPlayerManager } from "./mprisPlayerManager.js";
import { DetailedPlayerWindow } from "./detailedPlayerWindow.js";

export const MediaPlayerIndicator = GObject.registerClass(
    { GTypeName: "MediaPlayerIndicator" },
    class MediaPlayerIndicator extends PanelMenu.Button {
        _init(extension) {
            super._init(0, "MediaPlayerIndicator");
            this._isDestroyed = false;
            this.add_style_class_name("mpris-indicator-main-button");
            this._settings = extension.getSettings();

            this._paletteManager = new PaletteManager();

            // Активний плеєр (адреса шини + проксі його MPRIS-інтерфейсу).
            // Записується сюди делегатами MprisPlayerManager нижче.
            this._currentPlayerAddress = null;
            this._playerProxy = null;
            this._currentArtUrl = null;

            // --- Стан сесії візуалізації перемотування (скрол по кнопці) ---
            this._seekActive = false;
            this._seekPositionUnknown = true;
            this._seekPosition = 0;
            this._seekLength = 0;
            this._seekHideTimeoutId = null;

            // Змінна для таймера довгого лівого кліку
            this._longPressTimeoutId = null;

            this.layout = new St.BoxLayout({
                style_class: "mpris-panel-button",
                vertical: false,
                // Це окремий інтерактивний шар усередині PanelMenu.Button.
                // FILL дає йому всю виділену для кнопки площу, зокрема коли
                // albumArt прихована в режимі "Тільки текст".
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                reactive: true,
                track_hover: true,
            });

            const initialRadius = this._settings.get_int("album-radius");
            this.albumArt = new CairoRoundedArt(initialRadius, this);

            this.trackLabel = new TrackLabel(this._settings, this);
            this.seekOverlay = new SeekOverlay();

            // Стек: trackLabel і seekOverlay займають РІВНО ту саму область
            // (Clutter.BinLayout), перемикання між ними — суто crossfade
            // opacity, без будь-якої зміни розміру самої кнопки.
            this._trackStack = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                y_align: Clutter.ActorAlign.FILL,
                y_expand: true,
            });
            this._trackStack.add_child(this.trackLabel);
            this._trackStack.add_child(this.seekOverlay);

            this.layout.add_child(this.albumArt);
            this.layout.add_child(this._trackStack);
            this.add_child(this.layout);

            // --- Візуальний стан кнопки (normal / hover / pressed) ---
            // Використовується _updateBackground() для вибору потрібного
            // кольору з палітри, згенерованої на основі середнього кольору
            // обкладинки. Тримаємо стан у JS, бо фон малюється inline-стилем
            // (rgba з intensity), а не через CSS :hover/:active псевдокласи.
            this._visualState = "normal";

            // Події обробляє внутрішній шар, а не PanelMenu.Button: інакше
            // вбудований обробник останньої відкриває popup. albumArt зупиняє
            // власні події, тож її клік і надалі відкриває прев'ю.
            this.layout.connect("enter-event", () => {
                if (this.menu.isOpen) return;
                this._visualState = "hover";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();
            });

            this.layout.connect("leave-event", () => {
                if (!this.menu.isOpen) {
                    this._visualState = "normal";
                    this._syncThemeButtonPseudoClasses();
                    this._updateBackground();
                }

                // Якщо курсор пішов з кнопки, скасовуємо довгий клік
                if (this._longPressTimeoutId) {
                    GLib.source_remove(this._longPressTimeoutId);
                    this._longPressTimeoutId = null;
                }

                if (this._seekActive) {
                    if (this._seekHideTimeoutId) {
                        GLib.source_remove(this._seekHideTimeoutId);
                        this._seekHideTimeoutId = null;
                    }
                    this._exitSeekMode();
                }
            });

            this.layout.connect("button-press-event", (_actor, event) => {
                this._visualState = "pressed";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();

                const button = event.get_button();
                if (button === Clutter.BUTTON_PRIMARY) {
                    if (this._longPressTimeoutId) {
                        GLib.source_remove(this._longPressTimeoutId);
                    }
                    // Запускаємо таймер на 500мс
                    this._longPressTimeoutId = GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT,
                        500,
                        () => {
                            this._longPressTimeoutId = null;
                            this.menu.toggle(); // Відкриваємо вікно
                            return GLib.SOURCE_REMOVE;
                        },
                    );
                }

                return Clutter.EVENT_STOP;
            });

            this.layout.connect("button-release-event", (_actor, event) => {
                // Якщо відпускання відбулось уже після того, як довгий клік
                // відкрив попап, стан кнопки має лишитись "pressed" — його
                // тримає обробник menu "open-state-changed".
                if (!this.menu.isOpen) {
                    this._visualState = "hover";
                    this._syncThemeButtonPseudoClasses();
                    this._updateBackground();
                }

                const button = event.get_button();
                if (button === Clutter.BUTTON_PRIMARY) {
                    if (this._longPressTimeoutId) {
                        // Таймер ще активний — це короткий клік (попередній трек)
                        GLib.source_remove(this._longPressTimeoutId);
                        this._longPressTimeoutId = null;
                        this._mprisCall("Previous");
                    }
                    // Якщо таймер null, отже вже спрацював довгий клік, нічого не робимо
                } else if (button === Clutter.BUTTON_SECONDARY) {
                    // Правий клік — наступний трек
                    this._mprisCall("Next");
                } else if (button === Clutter.BUTTON_MIDDLE) {
                    // Середній клік — play/pause
                    this._mprisCall("PlayPause");
                }
                return Clutter.EVENT_STOP;
            });

            this.layout.connect("scroll-event", (_actor, event) => {
                const direction = event.get_scroll_direction();
                const seekStepUs = this._settings.get_int("seek-step");
                let offsetUs = 0;
                if (direction === Clutter.ScrollDirection.UP) {
                    offsetUs = seekStepUs;
                } else if (direction === Clutter.ScrollDirection.DOWN) {
                    offsetUs = -seekStepUs;
                } else {
                    return Clutter.EVENT_STOP;
                }
                this._handleSeekScroll(offsetUs);
                return Clutter.EVENT_STOP;
            });

            this._heightNotifyId = this.connect("notify::height", () => {
                if (this.albumArt) this.albumArt.setTargetHeight(this.height);
            });

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (!this._isDestroyed && this.height > 0 && this.albumArt)
                    this.albumArt.setTargetHeight(this.height);
                return GLib.SOURCE_REMOVE;
            });

            // Додаємо екземпляр DetailedPlayerWindow у стандартне меню
            this._detailedWindow = new DetailedPlayerWindow(this);
            const detailedMenuItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });
            detailedMenuItem.add_child(this._detailedWindow);
            this.menu.addMenuItem(detailedMenuItem);

            // Живе опитування позиції для прогрес-бару в попапі — MPRIS не
            // шле Position через PropertiesChanged, тож поки попап
            // відкритий, раз на секунду явно запитуємо її. Таймер живе
            // лише під час відкритого меню, щоб не смітити D-Bus запитами
            // постійно у фоні.
            this._detailedProgressTimeoutId = null;
            this.menu.connect("open-state-changed", (_menu, isOpen) => {
                // Поки попап відкритий, кнопка має виглядати "натиснутою"
                // незалежно від того, де зараз курсор.
                this._visualState = isOpen ? "pressed" : "normal";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();

                if (isOpen) {
                    this._pollDetailedProgress();
                    if (!this._detailedProgressTimeoutId) {
                        this._detailedProgressTimeoutId = GLib.timeout_add(
                            GLib.PRIORITY_DEFAULT,
                            1000,
                            () => {
                                this._pollDetailedProgress();
                                return GLib.SOURCE_CONTINUE;
                            },
                        );
                    }
                } else if (this._detailedProgressTimeoutId) {
                    GLib.source_remove(this._detailedProgressTimeoutId);
                    this._detailedProgressTimeoutId = null;
                }
            });

            // Замість підключення лише до першого знайденого плеєра, менеджер
            // стежить одразу за ВСІМА активними MPRIS-плеєрами. На кнопці
            // завжди показуються метадані того плеєра, в якому користувач
            // востаннє виконав активну дію (play/pause/next/seek/зміна треку
            // тощо) — рішення про це приймає MprisPlayerManager, а результат
            // приходить сюди через делегата.
            this._playerManager = new MprisPlayerManager(this._settings, {
                getActiveAddress: () => this._currentPlayerAddress,
                activatePlayer: (address, proxy) =>
                    this._setActivePlayer(address, proxy),
                refreshVisibility: () => this._updateVisibility(),
                clearActivePlayer: () => this._clearActivePlayer(),
            });

            this._settingsId = this._settings.connect("changed", () =>
                this._applyCustomStyles(),
            );
            this._playersSettingsId = this._settings.connect(
                "changed::media-players",
                () => this._updateVisibility(),
            );

            // Кешований фон панелі скидаємо при зміні теми (світла/темна тощо),
            // інакше адаптивний колір тексту продовжить рахуватись відносно
            // вже неактуального фону після перемикання теми "на льоту".
            this._themeContext = St.ThemeContext.get_for_stage(global.stage);
            this._themeChangedId = this._themeContext.connect("changed", () => {
                this._paletteManager.resetThemeCache();
                this._applyCustomStyles();
            });

            this._applyCustomStyles();
            this.visible = false;
        }

        /**
         * Надсилає MPRIS-метод (Next / Previous / PlayPause) до поточного плеєра.
         */
        _mprisCall(method) {
            if (!this._playerProxy || !this._currentPlayerAddress) return;
            this._playerManager.call(this._currentPlayerAddress, method);
        }

        /**
         * Надсилає MPRIS Seek (offset у мікросекундах, може бути від'ємним).
         */
        _mprisSeek(offsetUs) {
            if (!this._playerProxy || !this._currentPlayerAddress) return;
            this._playerManager.seek(this._currentPlayerAddress, offsetUs);
        }

        /**
         * "Тік" живого опитування позиції для прогрес-бару в попапі —
         * викликається раз на секунду, поки меню відкрите (див. підписку
         * на 'open-state-changed' вище). Під час активного seek-жесту на
         * кнопці панелі (_seekActive) пропускаємо опитування, щоб не
         * "битись" за той самий стан із _handleSeekScroll/_syncSeekPosition.
         */
        async _pollDetailedProgress() {
            if (this._isDestroyed || !this._detailedWindow) return;
            if (this._seekActive) return;
            if (!this._currentPlayerAddress) return;

            const position = await this._playerManager.getPosition(
                this._currentPlayerAddress,
            );
            if (this._isDestroyed || !this._detailedWindow) return;
            if (position === null) return;

            this._detailedWindow.updateProgress(
                position,
                this._seekLength || 0,
            );
        }

        /**
         * Викликається на кожен "тік" скролу над кнопкою. Одразу шле
         * реальний MPRIS Seek (без затримки), паралельно веде локальний
         * рахунок позиції для миттєвого відображення прогрес-бару й
         * таймкоду — не чекаючи підтвердження від плеєра.
         */
        _handleSeekScroll(offsetUs) {
            if (this._isDestroyed || !this._currentPlayerAddress) return;

            this._mprisSeek(offsetUs);

            if (!this._seekActive) this._enterSeekMode();

            const length = this._seekLength || 0;
            const upperBound = length > 0 ? length : Number.MAX_SAFE_INTEGER;
            this._seekPosition = Math.max(
                0,
                Math.min((this._seekPosition || 0) + offsetUs, upperBound),
            );
            this.seekOverlay.updateProgress(this._seekPosition, length);
            this._syncSeekWidth();

            this._resetSeekHideTimer();

            // На старті сесії локальна позиція невідома (стартує з 0) —
            // одразу підтягуємо реальну асинхронно і без стрибка коригуємо базу.
            if (this._seekPositionUnknown) {
                this._seekPositionUnknown = false;
                this._syncSeekPosition(this._currentPlayerAddress);
            }
        }

        /**
         * Вмикає режим перемотування: crossfade тексту в прогрес-бар/таймкод
         * (200мс), кольори оверлею беруться з поточної палітри кнопки.
         */
        _enterSeekMode() {
            this._seekActive = true;
            this._seekPositionUnknown = true;
            this._seekPosition = 0;

            this.seekOverlay.setColors(
                this._palette ? this._palette.background : null,
                this._palette ? this._palette.text : null,
            );

            this.trackLabel.remove_transition("opacity");
            this.trackLabel.ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            this.seekOverlay.opacity = 0;
            this.seekOverlay.visible = true;
            this.seekOverlay.remove_all_transitions();
            this.seekOverlay.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
        }

        /**
         * Вимикає режим перемотування: crossfade назад до тексту (200мс).
         */
        _exitSeekMode() {
            if (!this._seekActive) return;
            this._seekActive = false;

            this.trackLabel.restoreNaturalWidth();

            this.seekOverlay.remove_all_transitions();
            this.seekOverlay.ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (!this._isDestroyed) this.seekOverlay.visible = false;
                },
            });

            this.trackLabel.remove_transition("opacity");
            this.trackLabel.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
        }

        /**
         * Миттєво (без анімації) скидає стан сесії перемотування —
         * використовується при зміні/зникненні активного плеєра, коли
         * плавний crossfade вже недоречний.
         */
        _resetSeekState() {
            if (this._seekHideTimeoutId) {
                GLib.source_remove(this._seekHideTimeoutId);
                this._seekHideTimeoutId = null;
            }
            this._seekActive = false;
            this._seekPositionUnknown = true;
            this._seekPosition = 0;

            if (this.seekOverlay) {
                this.seekOverlay.remove_all_transitions();
                this.seekOverlay.opacity = 0;
                this.seekOverlay.visible = false;
            }
            if (this.trackLabel) {
                this.trackLabel.remove_all_transitions();
                this.trackLabel.opacity = 255;
                this.trackLabel.set_width(-1);
            }
        }

        /**
         * Підганяє ширину кнопки під поточний таймкод, якщо він ширший за
         * природну ширину назви треку — тією ж анімацією, що й зміна треку.
         */
        _syncSeekWidth() {
            if (this._isDestroyed || !this.seekOverlay || !this.trackLabel)
                return;
            this.trackLabel.growToFit(this.seekOverlay.getRequiredWidth());
        }

        /**
         * Перезапускає таймер автоприховування оверлею перемотування —
         * якщо скролів більше нема протягом 1.5с, повертаємось до тексту.
         */
        _resetSeekHideTimer() {
            if (this._seekHideTimeoutId) {
                GLib.source_remove(this._seekHideTimeoutId);
            }
            const hideDelayMs = this._settings.get_int(
                "seek-timecode-duration",
            );
            this._seekHideTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                hideDelayMs,
                () => {
                    this._seekHideTimeoutId = null;
                    this._exitSeekMode();
                    return GLib.SOURCE_REMOVE;
                },
            );
        }

        /**
         * Одноразовий запит реальної позиції відтворення по DBus
         * (Position не приходить через PropertiesChanged за специфікацією
         * MPRIS, тому читаємо напряму через org.freedesktop.DBus.Properties.Get,
         * як і Identity в mprisPlayerManager.js).
         */
        async _syncSeekPosition(address) {
            try {
                const result = await Gio.DBus.session.call(
                    address,
                    "/org/mpris/MediaPlayer2",
                    "org.freedesktop.DBus.Properties",
                    "Get",
                    new GLib.Variant("(ss)", [
                        "org.mpris.MediaPlayer2.Player",
                        "Position",
                    ]),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                );

                if (
                    this._isDestroyed ||
                    !this._seekActive ||
                    this._currentPlayerAddress !== address
                )
                    return;

                if (result) {
                    let [variant] = result.recursiveUnpack();
                    this._seekPosition = Number(variant) || 0;
                    this.seekOverlay.updateProgress(
                        this._seekPosition,
                        this._seekLength || 0,
                    );
                    this._syncSeekWidth();
                }
            } catch (e) {
                // Деякі плеєри не підтримують властивість Position —
                // лишаємось на локально порахованій позиції.
                log(`MPRIS Position query error: ${e.message}`);
            }
        }

        _applyCustomStyles() {
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
        }

        /**
         * Перемальовує лише background-color кнопки відповідно до поточного
         * this._visualState (normal/hover/pressed), не чіпаючи трек-лейбл чи
         * обкладинку. Викликається і з _applyCustomStyles() (при зміні
         * налаштувань/обкладинки), і з enter/leave/press-обробників —
         * тому винесена окремо, аби не перераховувати HSL щоразу.
         */
        _updateBackground() {
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

        /**
         * Події кнопки обробляє її внутрішній layout, тому PanelMenu.Button
         * не отримує press/release і сам не перемикає :active. У режимі
         * системного вигляду синхронізуємо псевдокласи вручну, щоб тема
         * застосувала свої штатні :hover та :active правила.
         */
        _syncThemeButtonPseudoClasses() {
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

        /**
         * Викликається MprisPlayerManager, коли новий плеєр стає активним.
         */
        _setActivePlayer(address, proxy) {
            if (this._isDestroyed) return;

            if (this._currentPlayerAddress !== address) this._resetSeekState();

            this._currentPlayerAddress = address;
            this._playerProxy = proxy;

            this._updateMetadata();
            this._updateVisibility();
        }

        /**
         * Викликається MprisPlayerManager, коли живих плеєрів більше нема.
         */
        _clearActivePlayer() {
            if (this._isDestroyed) return;

            this._resetSeekState();
            this._currentPlayerAddress = null;
            this._playerProxy = null;
            this._currentArtUrl = null;

            this._updateVisibility();
            if (this.albumArt && this.albumArt.updateArt) {
                this.albumArt.updateArt(
                    null,
                    this._settings.get_int("album-radius"),
                );
            }
        }

        _updateMetadata() {
            if (!this._playerProxy) return;

            try {
                let metadataVariant =
                    this._playerProxy.get_cached_property("Metadata");
                if (!metadataVariant && this._playerProxy.Metadata) {
                    metadataVariant = this._playerProxy.Metadata;
                }

                if (!metadataVariant) {
                    this.trackLabel.set_text("Очікування даних...");
                    return;
                }

                let metadata = metadataVariant.recursiveUnpack
                    ? metadataVariant.recursiveUnpack()
                    : metadataVariant.deep_unpack();

                this.trackLabel.updateFromMetadata(metadata);

                // Оновлюємо дані у детальному вікні
                const appId = this._playerManager.getAppIdentifier(
                    this._currentPlayerAddress,
                );
                if (this._detailedWindow) {
                    this._detailedWindow.updateInfo(metadata, appId);
                }

                this._seekLength = Number(metadata["mpris:length"]) || 0;
                if (this._seekActive) {
                    this.seekOverlay.updateProgress(
                        this._seekPosition,
                        this._seekLength,
                    );
                    this._syncSeekWidth();
                }

                let artUrl = metadata["mpris:artUrl"] || "";
                this._currentArtUrl = artUrl;
                const radius = this._settings.get_int("album-radius");

                if (
                    this.albumArt &&
                    typeof this.albumArt.updateArt === "function"
                ) {
                    this.albumArt.updateArt(artUrl, radius);
                }

                this._applyCustomStyles();
            } catch (e) {
                this.trackLabel.set_text(`Помилка: ${e.message}`);
                log(`MPRIS Metadata Error: ${e.message}`);
            }
        }

        _updateVisibility() {
            if (!this._playerProxy || !this._currentPlayerAddress) {
                this.visible = false;
                return;
            }

            try {
                const playbackStatus = this._playerProxy.PlaybackStatus;
                const isActive =
                    playbackStatus === "Playing" || playbackStatus === "Paused";

                const appId = this._playerManager.getAppIdentifier(
                    this._currentPlayerAddress,
                );
                const players = JSON.parse(
                    this._settings.get_string("media-players"),
                );

                const config = players[appId];
                const isAllowed = config ? config.visible : true;

                this.visible = isActive && isAllowed;
            } catch (e) {
                this.visible = false;
            }
        }

        destroy() {
            this._isDestroyed = true;
            if (this._longPressTimeoutId) {
                GLib.source_remove(this._longPressTimeoutId);
                this._longPressTimeoutId = null;
            }
            if (this._seekHideTimeoutId) {
                GLib.source_remove(this._seekHideTimeoutId);
                this._seekHideTimeoutId = null;
            }
            if (this._detailedProgressTimeoutId) {
                GLib.source_remove(this._detailedProgressTimeoutId);
                this._detailedProgressTimeoutId = null;
            }
            if (this._settingsId) this._settings.disconnect(this._settingsId);
            if (this._playersSettingsId)
                this._settings.disconnect(this._playersSettingsId);
            if (this._heightNotifyId) this.disconnect(this._heightNotifyId);
            if (this._themeChangedId && this._themeContext)
                this._themeContext.disconnect(this._themeChangedId);

            if (this._playerManager) this._playerManager.destroy();
            this._playerProxy = null;
            this._currentPlayerAddress = null;

            super.destroy();
        }
    },
);
