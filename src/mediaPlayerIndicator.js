import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Cairo from "gi://cairo";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { TrackLabel } from "./textLabel.js";
import { CairoRoundedArt } from "./artLabel.js";
import { SeekOverlay } from "./seekOverlay.js";
import { SeekController } from "./seekController.js";
import { ProgressController } from "./progressController.js";
import { DisplayMode } from "./constants.js";
import { PaletteManager } from "./paletteManager.js";
import { MprisPlayerManager } from "./mprisPlayerManager.js";
import { DetailedPlayerWindow } from "./detailedPlayerWindow.js";
import { calculatePanelProgressGeometry, paintPanelProgress } from "./panelProgress.js";

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
            this._currentTrackKey = null;

            // --- Стан сесії візуалізації перемотування (скрол по кнопці) ---
            this._seekActive = false;
            this._seekPositionUnknown = true;
            this._seekPosition = 0;
            this._seekLength = 0;
            this._panelProgressPosition = 0;
            this._panelProgressGeometry = null;
            this._panelProgressTimeoutId = null;
            this._panelProgressPollInFlight = false;
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
            this._seekController = new SeekController(this);

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

            // Прогрес малюється окремим шаром позаду вмісту кнопки.
            // Track починається після обкладинки, fill заходить під неї
            // на половину ширини; сама обкладинка залишається незатіненою.
            // St.DrawingArea не має дочірніх акторів, тому ширина track/fill
            // не бере участі в обчисленні natural size кнопки. Це запобігає
            // накопиченню ширини після кожної зміни треку.
            this._progressLayer = new St.DrawingArea({
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
                reactive: false,
            });
            this._progressLayer.connect("repaint", (area) => {
                paintPanelProgress(area, {
                    Cairo,
                    geometry: this._panelProgressGeometry,
                    position: this._panelProgressPosition,
                    duration: this._seekLength,
                    radius: this._currentRadius,
                    settings: this._settings,
                });
            });

            // Фоновий шар і вміст мають бути шарами одного BinLayout.
            // Не додаємо смужку прямо в PanelMenu.Button: інакше вона
            // впливає на preferred size кнопки й стискає її по ширині.
            this._buttonStack = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
                reactive: true,
                track_hover: true,
            });
            this._buttonStack.add_child(this._progressLayer);

            this.layout.add_child(this.albumArt);
            this.layout.add_child(this._trackStack);
            this._buttonStack.add_child(this.layout);
            this.add_child(this._buttonStack);

            // --- Візуальний стан кнопки (normal / hover / pressed) ---
            // Використовується _updateBackground() для вибору потрібного
            // кольору з палітри, згенерованої на основі середнього кольору
            // обкладинки. Тримаємо стан у JS, бо фон малюється inline-стилем
            // (rgba з intensity), а не через CSS :hover/:active псевдокласи.
            this._visualState = "normal";

            // Події обробляються повнорозмірним _buttonStack. artLabel має
            // власні обробники, які зупиняють події, тож на обкладинці ці
            // дії не спрацьовують; решта кнопки реагує на всю свою площу.
            this._buttonStack.connect("enter-event", () => {
                if (this.menu.isOpen) return;
                this._visualState = "hover";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();
            });

            this._buttonStack.connect("leave-event", () => {
                if (!this.menu.isOpen) {
                    this._visualState = "normal";
                    this._syncThemeButtonPseudoClasses();
                    this._updateBackground();
                }

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

            this._buttonStack.connect("button-press-event", (_actor, event) => {
                this._visualState = "pressed";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();

                if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                    if (this._longPressTimeoutId)
                        GLib.source_remove(this._longPressTimeoutId);
                    this._longPressTimeoutId = GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT,
                        500,
                        () => {
                            this._longPressTimeoutId = null;
                            if (!this._isDestroyed) this.menu.toggle();
                            return GLib.SOURCE_REMOVE;
                        },
                    );
                }
                return Clutter.EVENT_STOP;
            });

            this._buttonStack.connect("button-release-event", (_actor, event) => {
                if (!this.menu.isOpen) {
                    this._visualState = "hover";
                    this._syncThemeButtonPseudoClasses();
                    this._updateBackground();
                }

                const button = event.get_button();
                if (button === Clutter.BUTTON_PRIMARY) {
                    if (this._longPressTimeoutId) {
                        GLib.source_remove(this._longPressTimeoutId);
                        this._longPressTimeoutId = null;
                        this._mprisCall("Previous");
                    }
                } else if (button === Clutter.BUTTON_SECONDARY) {
                    this._mprisCall("Next");
                } else if (button === Clutter.BUTTON_MIDDLE) {
                    this._mprisCall("PlayPause");
                }
                return Clutter.EVENT_STOP;
            });

            this._buttonStack.connect("scroll-event", (_actor, event) => {
                const direction = event.get_scroll_direction();
                // MPRIS offsets are in microseconds: 5 seconds = 5,000,000.
                if (direction === Clutter.ScrollDirection.UP) {
                    this._handleSeekScroll(5_000_000);
                } else if (direction === Clutter.ScrollDirection.DOWN) {
                    this._handleSeekScroll(-5_000_000);
                }
                return Clutter.EVENT_STOP;
            });

            this._heightNotifyId = this.connect("notify::height", () => {
                if (this.albumArt) this.albumArt.setTargetHeight(this.height);
                this._updatePanelProgressGeometry();
            });
            this._widthNotifyId = this.connect("notify::width", () =>
                this._updatePanelProgressGeometry(),
            );
            this._albumArtWidthNotifyId = this.albumArt.connect(
                "notify::width",
                () => this._updatePanelProgressGeometry(),
            );

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
            this._progressController = new ProgressController(this);
            this.menu.connect("open-state-changed", (_menu, isOpen) => {
                // Поки попап відкритий, кнопка має виглядати "натиснутою"
                // незалежно від того, де зараз курсор.
                this._visualState = isOpen ? "pressed" : "normal";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();

                this._progressController.setDetailedProgressPolling(isOpen);
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

        /** Спільний обробник натискання для всієї кнопки, включно з обкладинкою. */
        _handlePanelButtonPress(event) {
            if (this._isDestroyed) return Clutter.EVENT_STOP;

            this._visualState = "pressed";
            this._syncThemeButtonPseudoClasses();
            this._updateBackground();

            const button = event.get_button();
            if (button === Clutter.BUTTON_PRIMARY) {
                if (this._longPressTimeoutId)
                    GLib.source_remove(this._longPressTimeoutId);

                this._longPressTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    500,
                    () => {
                        this._longPressTimeoutId = null;
                        if (!this._isDestroyed) this.menu.toggle();
                        return GLib.SOURCE_REMOVE;
                    },
                );
            }

            return Clutter.EVENT_STOP;
        }

        /** Лівий/правий/середній кліки однаково працюють на всій кнопці. */
        _handlePanelButtonRelease(event) {
            if (this._isDestroyed) return Clutter.EVENT_STOP;

            if (!this.menu.isOpen) {
                this._visualState = "hover";
                this._syncThemeButtonPseudoClasses();
                this._updateBackground();
            }

            const button = event.get_button();
            if (button === Clutter.BUTTON_PRIMARY) {
                if (this._longPressTimeoutId) {
                    GLib.source_remove(this._longPressTimeoutId);
                    this._longPressTimeoutId = null;
                    this._mprisCall("Previous");
                }
            } else if (button === Clutter.BUTTON_SECONDARY) {
                this._mprisCall("Next");
            } else if (button === Clutter.BUTTON_MIDDLE) {
                this._mprisCall("PlayPause");
            }

            return Clutter.EVENT_STOP;
        }

        /** Прокрутка над текстом/порожньою ділянкою кнопки лишається seek-керуванням. */
        _handlePanelScroll(event) {
            if (this._isDestroyed) return Clutter.EVENT_STOP;

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
         * Track займає кнопку за винятком ширини обкладинки. Fill має
         * додаткове продовження під обкладинку на половину її ширини.
         */
        _updatePanelProgressGeometry() {
            if (
                this._isDestroyed ||
                !this._progressLayer ||
                !this.layout
            )
                return;

            const geometry = calculatePanelProgressGeometry({
                width: this.width,
                height: this.height,
                layoutX: this.layout.x,
                artVisible: Boolean(
                    this.albumArt &&
                    this.albumArt.visible &&
                    this.albumArt.width > 0,
                ),
                artWidth: this.albumArt?.width,
                artX: this.albumArt?.x,
            });

            if (!geometry) {
                this._panelProgressGeometry = null;
                this._progressLayer.queue_repaint();
                return;
            }

            this._panelProgressGeometry = geometry;
            // Track прозорий — малюємо лише fill на St.DrawingArea.
            this._progressLayer.queue_repaint();
        }

        /** Оновлює fill за позицією й тривалістю MPRIS у мікросекундах. */
        _updatePanelProgressFill(position, length) {
            if (this._isDestroyed || !this._progressLayer) return;
            this._panelProgressPosition = Math.max(0, Number(position) || 0);
            this._progressLayer.queue_repaint();
        }

        /**
         * MPRIS не надсилає Position через PropertiesChanged, тому читаємо
         * позицію напряму. Під час перемотування зберігаємо локальний відгук.
         */
        async _pollPanelProgress() {
            return this._progressController.pollPanelProgress();
        }

        _startPanelProgressPolling() {
            this._progressController.startPanelProgressPolling();
        }

        _stopPanelProgressPolling() {
            this._progressController.stopPanelProgressPolling();
        }

        async _pollDetailedProgress() {
            return this._progressController.pollDetailedProgress();
        }

        /**
         * Викликається на кожен "тік" скролу над кнопкою. Одразу шле
         * реальний MPRIS Seek (без затримки), паралельно веде локальний
         * рахунок позиції для миттєвого відображення прогрес-бару й
         * таймкоду — не чекаючи підтвердження від плеєра.
         */
        _handleSeekScroll(offsetUs) {
            this._seekController.handleSeekScroll(offsetUs);
        }

        _enterSeekMode() {
            this._seekController.enterSeekMode();
        }

        _exitSeekMode() {
            this._seekController.exitSeekMode();
        }

        _resetSeekState() {
            this._seekController.resetSeekState();
        }

        _syncSeekWidth() {
            this._seekController.syncSeekWidth();
        }

        _resetSeekHideTimer() {
            this._seekController.resetSeekHideTimer();
        }

        async _syncSeekPosition(address) {
            return this._seekController.syncSeekPosition(address);
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
            this._updatePanelProgressGeometry();
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

            if (this._currentPlayerAddress !== address) {
                this._resetSeekState();
                this._panelProgressPosition = 0;
                this._currentTrackKey = null;
            }

            this._currentPlayerAddress = address;
            this._playerProxy = proxy;

            this._updateMetadata();
            this._updateVisibility();
            if (proxy.PlaybackStatus === "Playing") {
                this._startPanelProgressPolling();
            } else {
                this._stopPanelProgressPolling();
                this._pollPanelProgress();
            }
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
            this._currentTrackKey = null;
            this._stopPanelProgressPolling();
            this._panelProgressPosition = 0;
            this._seekLength = 0;
            this._updatePanelProgressFill(0, 0);

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

                // Ідентифікуємо саме трек, а не адресу MPRIS-плеєра.
                // Деякі плеєри повторно використовують адресу для всього списку.
                const artists = metadata["xesam:artist"];
                const trackKey = JSON.stringify({
                    id: String(metadata["mpris:trackid"] ?? ""),
                    title: String(metadata["xesam:title"] ?? ""),
                    artists: Array.isArray(artists)
                        ? artists.map(String)
                        : [String(artists ?? "")],
                    album: String(metadata["xesam:album"] ?? ""),
                });

                if (
                    this._currentTrackKey !== null &&
                    trackKey !== this._currentTrackKey
                ) {
                    // Не чекаємо, поки зникне таймкод після прокручування.
                    // _resetSeekState також скасовує старий таймер таймкоду.
                    this._resetSeekState();
                    this._panelProgressPosition = 0;
                }
                this._currentTrackKey = trackKey;

                this._seekLength = Number(metadata["mpris:length"]) || 0;
                this._updatePanelProgressFill(
                    this._panelProgressPosition,
                    this._seekLength,
                );
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
            if (this._progressController) this._progressController.stopDetailedProgressPolling();
            this._stopPanelProgressPolling();
            if (this._settingsId) this._settings.disconnect(this._settingsId);
            if (this._playersSettingsId)
                this._settings.disconnect(this._playersSettingsId);
            if (this._heightNotifyId) this.disconnect(this._heightNotifyId);
            if (this._widthNotifyId) this.disconnect(this._widthNotifyId);
            if (this._albumArtWidthNotifyId && this.albumArt)
                this.albumArt.disconnect(this._albumArtWidthNotifyId);
            if (this._themeChangedId && this._themeContext)
                this._themeContext.disconnect(this._themeChangedId);

            if (this._playerManager) this._playerManager.destroy();
            this._playerProxy = null;
            this._currentPlayerAddress = null;

            super.destroy();
        }
    },
);
