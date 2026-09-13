import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { fetchLyrics } from "./lyricsGrabber.js";

// ==========================================
// 1. TopLayer
// ==========================================
const TopLayer = GObject.registerClass(
    { GTypeName: "TopLayer" },
    class TopLayer extends St.BoxLayout {
        _init(onLyricsClicked, onFavoriteClicked) {
            super._init({
                vertical: false,
                style: "spacing: 10px;",
            });

            this.SourceIcon = new St.Icon({
                icon_name: "audio-x-generic-symbolic",
                icon_size: 24,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const topSpacer = new St.Widget({
                x_expand: true,
                y_expand: true,
            });

            this.ActionsBox = new St.BoxLayout({
                vertical: false,
                y_align: Clutter.ActorAlign.CENTER,
                style: "spacing: 10px;",
            });

            this.LyricsButton = new St.Button({
                child: new St.Icon({
                    icon_name: "text-align-center-symbolic",
                    icon_size: 24,
                }),
                reactive: true,
                can_focus: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.LyricsButton.connect("clicked", onLyricsClicked);

            this.FavouriteButton = new St.Button({
                child: new St.Icon({
                    icon_name: "workspacelistentryicon-heart-symbolic",
                    icon_size: 24,
                }),
                reactive: true,
                can_focus: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.FavouriteButton.connect("clicked", onFavoriteClicked);

            this.ActionsBox.add_child(this.LyricsButton);
            this.ActionsBox.add_child(this.FavouriteButton);

            this.add_child(this.SourceIcon);
            this.add_child(topSpacer);
            this.add_child(this.ActionsBox);
        }

        updateFavoriteState(isFavorited) {
            const newIconName = isFavorited
                ? "heart-filled-symbolic"
                : "workspacelistentryicon-heart-symbolic";
            this.FavouriteButton.set_child(
                new St.Icon({
                    icon_name: newIconName,
                    icon_size: 24,
                }),
            );
        }

        setLyricsOpacity(opacity) {
            this.LyricsButton.opacity = opacity;
        }

        setSourceIcon(appIdentifier) {
            if (appIdentifier) {
                this.SourceIcon.set_icon_name(appIdentifier);
            }
        }
    },
);

// ==========================================
// 1.5. LyricsScrollTrack — кастомний оверлей-скролбар
// ==========================================
// Малює тонкий "thumb" поверх LyricsView (не бере участі в розрахунку
// ширини контейнера — vfunc_get_preferred_width навмисно [0, 0], так само
// як SeekOverlay). Позиція й розмір thumb рахуються вручну із
// St.Adjustment самого ScrollView (updateFromAdjustment). Видимість/fade
// керується ззовні (ContentLayer) через opacity-анімації — тут лишень
// геометрія.
const LyricsScrollTrack = GObject.registerClass(
    { GTypeName: "LyricsScrollTrack" },
    class LyricsScrollTrack extends St.Widget {
        _init() {
            super._init({
                reactive: false,
                // FILL + x_expand: true — ОБОВ'ЯЗКОВО, разом із [0, 0] у
                // vfunc_get_preferred_width нижче. З Clutter.BinLayout,
                // якщо x_align != FILL, розкладка вирівнює дочірній
                // елемент за його ПРИРОДНИМ розміром (тут — 0), і трек
                // отримує нульову ширину незалежно від власної логіки у
                // vfunc_allocate. Точний той самий патерн, що й у
                // SeekOverlay.
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
                opacity: 0,
            });

            this._thumbRatio = 0; // позиція thumb: 0..1
            this._thumbSize = 1; // висота thumb відносно треку: 0..1

            // Тимчасова заглушка — DetailedPlayerWindow._applyAccentColor()
            // підмінить на колір теми (той самий, що й в активної частини
            // прогрес-бару).
            this._thumb = new St.Widget({
                style: "background-color: rgba(255, 255, 255, 0.35); border-radius: 3px;",
            });
            this.add_child(this._thumb);
        }

        /**
         * Пофарбувати thumb кольором активної частини прогрес-бару (той
         * самий колір, лише скролбар завжди на 100% альфи).
         */
        setColor(activeColor) {
            this._thumb.set_style(
                `background-color: ${activeColor}; border-radius: 3px;`,
            );
        }

        // Навмисно [0, 0]: трек не повинен впливати на ширину, яку
        // виділяє LyricsStack — вона й так задається самим LyricsView.
        vfunc_get_preferred_width(forHeight) {
            return [0, 0];
        }

        vfunc_get_preferred_height(forWidth) {
            return [0, 0];
        }

        vfunc_allocate(box) {
            this.set_allocation(box);

            const height = box.get_height();
            const trackWidth = 6;
            // Розміщуємо трек у крайніх 6px праворуч від власного боксу
            // (сам бокс — це вся ширина LyricsStack, END-вирівнювання тут
            // не діє, бо ми навмисно повертаємо [0,0] у preferred-width,
            // тож розташування рахуємо вручну).
            const x2 = box.get_width();
            const x1 = x2 - trackWidth;

            const thumbHeight = Math.max(24, height * this._thumbSize);
            const maxY = Math.max(0, height - thumbHeight);
            const thumbY = maxY * this._thumbRatio;

            const thumbBox = new Clutter.ActorBox();
            thumbBox.x1 = x1;
            thumbBox.x2 = x2;
            thumbBox.y1 = Math.round(thumbY);
            thumbBox.y2 = thumbBox.y1 + Math.round(thumbHeight);
            this._thumb.allocate(thumbBox);
        }

        /**
         * Перераховує позицію/розмір thumb із поточного стану
         * St.Adjustment вбудованого vscroll. Якщо контент не переповнює
         * viewport — трек ховається (скролити нема чого).
         */
        updateFromAdjustment(adjustment) {
            const lower = adjustment.lower;
            const upper = adjustment.upper;
            const pageSize = adjustment.page_size;
            const scrollableRange = upper - lower - pageSize;

            if (scrollableRange <= 0) {
                this.hide();
                return;
            }

            this.show();
            this._thumbSize = pageSize / (upper - lower);
            this._thumbRatio = (adjustment.value - lower) / scrollableRange;
            this.queue_relayout();
        }
    },
);

// ==========================================
// 2. ContentLayer
// ==========================================
const ContentLayer = GObject.registerClass(
    { GTypeName: "ContentLayer" },
    class ContentLayer extends St.Widget {
        _init() {
            super._init({
                layout_manager: new Clutter.BinLayout(),
            });

            // Метадані
            this.MetadataView = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.CENTER,
                style: "spacing: 8px;",
            });

            this.TitleLabel = new St.Label({
                text: "Назва треку",
                style: "font-size: 16px; font-weight: bold; text-align: center;",
                x_align: Clutter.ActorAlign.CENTER,
            });
            this.ArtistLabel = new St.Label({
                text: "Ім'я виконавця",
                style: "font-size: 14px; opacity: 0.5; text-align: center;",
                x_align: Clutter.ActorAlign.CENTER,
            });
            this.AlbumLabel = new St.Label({
                text: "Назва альбому",
                style: "font-size: 14px; opacity: 0.5; text-align: center;",
                x_align: Clutter.ActorAlign.CENTER,
            });

            this.MetadataView.add_child(this.TitleLabel);
            this.MetadataView.add_child(this.ArtistLabel);
            this.MetadataView.add_child(this.AlbumLabel);

            // Текст пісні (ScrollView)
            // vscrollbar_policy: EXTERNAL — вбудований StScrollBar НЕ
            // рендериться і НЕ резервує власної ширини в layout (на
            // відміну від AUTOMATIC). Замість нього — власний тонкий
            // оверлей-скролбар LyricsScrollTrack нижче, прив'язаний до
            // того самого St.Adjustment (this.LyricsView.vadjustment —
            // ВАЖЛИВО: не .vscroll.adjustment, бо з EXTERNAL сам
            // scrollbar-віджет .vscroll взагалі не створюється й
            // лишається undefined; vadjustment існує незалежно від нього).
            this.LyricsView = new St.ScrollView({
                vscrollbar_policy: St.PolicyType.EXTERNAL,
                hscrollbar_policy: St.PolicyType.NEVER,
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.FILL,
                reactive: true, // ВАЖЛИВО: щоб приймав події миші для скролу
                track_hover: true,
            });

            this._lyricsLabel = new St.Label({
                style: "font-size: 14px; text-align: center;",
                x_expand: true,
                y_expand: false,
                x_align: Clutter.ActorAlign.FILL,
            });

            this._lyricsLabel.clutter_text.line_wrap = true;
            this._lyricsLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
            this._lyricsLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

            const lyricsBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });

            lyricsBox.add_child(this._lyricsLabel);
            this.LyricsView.set_child(lyricsBox);

            this._lyricsScrollTrack = new LyricsScrollTrack();

            // Стек LyricsView + кастомний скролбар. Саме цей контейнер
            // (а не LyricsView напряму) тепер показується/ховається й
            // crossfade'иться з MetadataView.
            this.LyricsStack = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_align: Clutter.ActorAlign.START,
                visible: false,
                opacity: 0,
                style: "margin-top: 12px; margin-bottom: 12px;",
            });
            this.LyricsStack.add_child(this.LyricsView);
            this.LyricsStack.add_child(this._lyricsScrollTrack);

            this._scrollFadeTimeoutId = null;
            this._setupLyricsScrollbarFade();

            this.add_child(this.MetadataView);
            this.add_child(this.LyricsStack);
        }

        /**
         * Ручний fade оверлей-скролбару: з'являється при скролі й наведенні,
         * ховається через паузу після зупинки активності — точна поведінка
         * рідного GNOME-скролбару, яку сама властивість St.ScrollView
         * "overlay-scrollbars" тут чомусь не забезпечила.
         */
        _setupLyricsScrollbarFade() {
            const adjustment = this.LyricsView.vadjustment;

            const showScrollbar = () => {
                if (this._scrollFadeTimeoutId) {
                    GLib.source_remove(this._scrollFadeTimeoutId);
                    this._scrollFadeTimeoutId = null;
                }
                this._lyricsScrollTrack.remove_transition("opacity");
                this._lyricsScrollTrack.ease({
                    opacity: 255,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            };

            const scheduleHideScrollbar = () => {
                if (this._scrollFadeTimeoutId)
                    GLib.source_remove(this._scrollFadeTimeoutId);
                this._scrollFadeTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    800,
                    () => {
                        this._scrollFadeTimeoutId = null;
                        this._lyricsScrollTrack.remove_transition("opacity");
                        this._lyricsScrollTrack.ease({
                            opacity: 0,
                            duration: 400,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                        return GLib.SOURCE_REMOVE;
                    },
                );
            };

            adjustment.connect("notify::value", () => {
                this._lyricsScrollTrack.updateFromAdjustment(adjustment);
                showScrollbar();
                scheduleHideScrollbar();
            });

            adjustment.connect("notify::upper", () => {
                this._lyricsScrollTrack.updateFromAdjustment(adjustment);
            });

            this.LyricsView.connect("enter-event", () => {
                showScrollbar();
                return Clutter.EVENT_PROPAGATE;
            });

            this.LyricsView.connect("leave-event", () => {
                scheduleHideScrollbar();
                return Clutter.EVENT_PROPAGATE;
            });
        }

        updateMetadata(title, artist, album) {
            this.TitleLabel.set_text(title);
            this.ArtistLabel.set_text(artist);
            this.AlbumLabel.set_text(album);
        }

        resetToMetadata() {
            this.LyricsStack.remove_all_transitions();
            this.LyricsStack.hide();
            this.LyricsStack.opacity = 0;

            this.MetadataView.remove_all_transitions();
            this.MetadataView.show();
            this.MetadataView.opacity = 255;
        }

        showLyrics(lyrics, maxScrollHeight) {
            this._lyricsLabel.set_text(lyrics);

            // Фіксуємо ширину лейбла явно, щоб текст коректно переносився і рахував висоту
            const currentWidth = (this.get_width() || 370) - 24;
            this._lyricsLabel.set_width(currentWidth);

            const [, natHeight] =
                this._lyricsLabel.get_preferred_height(currentWidth);

            // Якщо реальна висота тексту більша за ліміт екрана — обмежуємо висоту ScrollView (вмикається скрол)
            // Якщо менша — даємо висоту самого тексту, щоб вікно не робило порожнього простору
            const finalHeight = Math.min(natHeight + 20, maxScrollHeight);
            this.LyricsView.set_height(finalHeight);
            this.LyricsStack.set_height(finalHeight);

            this.MetadataView.ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this.MetadataView.hide();
                    this.LyricsStack.show();
                    this.LyricsStack.opacity = 0;
                    this._lyricsScrollTrack.updateFromAdjustment(
                        this.LyricsView.vadjustment,
                    );
                    this.LyricsStack.ease({
                        opacity: 255,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    });
                },
            });
        }

        hideLyrics() {
            this.LyricsStack.ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this.LyricsStack.hide();
                    this.MetadataView.show();
                    this.MetadataView.ease({
                        opacity: 255,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    });
                },
            });
        }

        showLyricsError() {
            const originalText = this.TitleLabel.get_text();
            this.TitleLabel.set_text("Текст не знайдено");

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                if (this.TitleLabel.get_text() === "Текст не знайдено") {
                    this.TitleLabel.set_text(originalText);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        setAccentColor(activeColor) {
            this._lyricsScrollTrack.setColor(activeColor);
        }
    },
);

// ==========================================
// 2.5. PlayerProgressBar — інтерактивний прогрес-бар (fill + click/drag-to-seek)
// ==========================================
// API MPRIS у цьому розширенні підтримує лише ВІДНОСНИЙ Seek (offset), без
// SetPosition — тому клік/драг рахує offset = цільова_позиція -
// остання_відома_позиція й передає його назовні через onSeek(offsetUs), як
// уже робить скрол на кнопці панелі (_mprisSeek).
const PlayerProgressBar = GObject.registerClass(
    { GTypeName: "PlayerProgressBar" },
    class PlayerProgressBar extends St.Widget {
        _init(onSeek) {
            super._init({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                track_hover: true,
                can_focus: false,
                style: "height: 4px; margin: 0 12px;",
            });

            this._onSeek = onSeek; // (offsetUs) => void
            this._position = 0; // мкс, остання відома (авторитетна) позиція
            this._length = 0; // мкс
            this._dragging = false;
            this._dragTargetPosition = null; // мкс, лише поки триває drag
            this._isDestroyed = false;

            // Тимчасові кольори-заглушки — одразу після побудови вікна
            // DetailedPlayerWindow._applyAccentColor() підмінить їх на
            // колір, зчитаний із теми (той самий, що й у кнопок).
            this._track = new St.Widget({
                style: "background-color: rgba(255, 255, 255, 0.2); border-radius: 4px;",
            });
            this._fill = new St.Widget({
                style: "background-color: rgb(255, 255, 255); border-radius: 4px;",
            });

            this.add_child(this._track);
            this.add_child(this._fill);

            this.connect(
                "button-press-event",
                this._onButtonPress.bind(this),
            );
            this.connect(
                "button-release-event",
                this._onButtonRelease.bind(this),
            );
            this.connect("motion-event", this._onMotion.bind(this));
            this.connect("destroy", () => {
                this._isDestroyed = true;
                this._onSeek = null;
            });
        }

        // Ширина: [0, 0] — навмисно, як і в SeekOverlay/LyricsScrollTrack.
        // Не беремо участі в розрахунку природної ширини ControlsLayer;
        // фактичну ширину дає x_expand: true в батьківському BoxLayout.
        vfunc_get_preferred_width(forHeight) {
            return [0, 0];
        }

        // Висота: фіксована товщина смужки прогрес-бару (раніше йшла з
        // CSS "height: 4px" на статичному St.Widget — тепер задаємо явно
        // в коді, бо CSS-похідний розмір не гарантовано підхоплюється
        // при кастомному vfunc_allocate).
        vfunc_get_preferred_height(forWidth) {
            return [4, 4];
        }

        vfunc_allocate(box) {
            this.set_allocation(box);

            const width = box.get_width();
            const height = box.get_height();

            const trackBox = new Clutter.ActorBox();
            trackBox.x1 = 0;
            trackBox.y1 = 0;
            trackBox.x2 = width;
            trackBox.y2 = height;
            this._track.allocate(trackBox);

            const displayPosition =
                this._dragging && this._dragTargetPosition !== null
                    ? this._dragTargetPosition
                    : this._position;
            const fraction =
                this._length > 0
                    ? Math.min(1, Math.max(0, displayPosition / this._length))
                    : 0;

            const fillBox = new Clutter.ActorBox();
            fillBox.x1 = 0;
            fillBox.y1 = 0;
            fillBox.x2 = Math.round(width * fraction);
            fillBox.y2 = height;
            this._fill.allocate(fillBox);
        }

        /**
         * Пофарбувати активну (fill) й неактивну (track) частини бару.
         * Кольори приходять готовими рядками (rgba(...)) — рахує їх
         * DetailedPlayerWindow._applyAccentColor() із кольору теми.
         */
        setColors(activeColor, inactiveColor) {
            if (this._isDestroyed) return;
            this._track.set_style(
                `background-color: ${inactiveColor}; border-radius: 4px;`,
            );
            this._fill.set_style(
                `background-color: ${activeColor}; border-radius: 4px;`,
            );
        }

        /**
         * Оновлює заповнення поточною позицією відтворення ззовні
         * (з періодичного опитування в indicator). Ігнорується під час
         * активного перетягування, щоб не "змагатись" із локальним
         * прев'ю.
         */
        updateProgress(positionUs, lengthUs) {
            if (this._dragging) return;

            this._position = Math.max(0, positionUs || 0);
            this._length = Math.max(0, lengthUs || 0);
            this.queue_relayout();
        }

        _fractionForEvent(event) {
            const [stageX] = event.get_coords();
            const [actorX] = this.get_transformed_position();
            const width = this.get_width();
            if (width <= 0) return 0;
            return Math.min(1, Math.max(0, (stageX - actorX) / width));
        }

        _onButtonPress(_actor, event) {
            if (this._length <= 0) return Clutter.EVENT_PROPAGATE;

            this._dragging = true;
            this._dragTargetPosition =
                this._fractionForEvent(event) * this._length;
            this.queue_relayout();
            return Clutter.EVENT_STOP;
        }

        _onMotion(_actor, event) {
            if (!this._dragging) return Clutter.EVENT_PROPAGATE;

            this._dragTargetPosition =
                this._fractionForEvent(event) * this._length;
            this.queue_relayout();
            return Clutter.EVENT_STOP;
        }

        _onButtonRelease() {
            if (!this._dragging) return Clutter.EVENT_PROPAGATE;

            this._dragging = false;

            if (this._dragTargetPosition !== null) {
                const offsetUs = Math.round(
                    this._dragTargetPosition - this._position,
                );
                this._position = this._dragTargetPosition;
                this._dragTargetPosition = null;
                this._onSeek?.(offsetUs);
            }

            return Clutter.EVENT_STOP;
        }
    },
);

// ==========================================
// 3. ControlsLayer
// ==========================================
const ControlsLayer = GObject.registerClass(
    { GTypeName: "ControlsLayer" },
    class ControlsLayer extends St.BoxLayout {
        _init(indicator) {
            super._init({
                vertical: false,
            });

            this.PreviousButton = new St.Button({
                child: new St.Icon({
                    icon_name: "media-skip-backward-symbolic",
                    icon_size: 24,
                }),
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            this.PreviousButton.connect("clicked", () => {
                if (indicator && typeof indicator._mprisCall === "function") {
                    indicator._mprisCall("Previous");
                }
            });

            this.ProgressBar = new PlayerProgressBar((offsetUs) => {
                if (indicator && typeof indicator._mprisSeek === "function") {
                    indicator._mprisSeek(offsetUs);
                }
            });

            this.NextButton = new St.Button({
                child: new St.Icon({
                    icon_name: "media-skip-forward-symbolic",
                    icon_size: 24,
                }),
                reactive: true,
                can_focus: true,
                track_hover: true,
            });
            this.NextButton.connect("clicked", () => {
                if (indicator && typeof indicator._mprisCall === "function") {
                    indicator._mprisCall("Next");
                }
            });

            this.add_child(this.PreviousButton);
            this.add_child(this.ProgressBar);
            this.add_child(this.NextButton);
        }

        updateProgress(positionUs, lengthUs) {
            this.ProgressBar.updateProgress(positionUs, lengthUs);
        }

        setAccentColor(activeColor, inactiveColor) {
            this.ProgressBar.setColors(activeColor, inactiveColor);
        }
    },
);

// ==========================================
// Головний віджет (MediaLabelPopup / DetailedPlayerWindow)
// ==========================================
export const DetailedPlayerWindow = GObject.registerClass(
    { GTypeName: "DetailedPlayerWindow" },
    class DetailedPlayerWindow extends St.BoxLayout {
        _init(indicator) {
            super._init({
                style_class: "detailed-player-window",
                vertical: true,
                width: 370,
                reactive: true,
                style: "background-color: rgba(30, 30, 30, 0); min-height: 150px;",
            });

            this._indicator = indicator;
            this._isFavorited = false;
            this._isShowingLyrics = false;
            this._isFetchingLyrics = false;
            this._currentArtist = "";
            this._currentTitle = "";

            // Ініціалізація трьох основних шарів
            this.TopLayer = new TopLayer(
                this._toggleLyrics.bind(this),
                this._toggleFavorite.bind(this),
            );

            this.ContentLayer = new ContentLayer();

            this.ControlsLayer = new ControlsLayer(this._indicator);

            // Явно задаємо layout-поведінку
            this.TopLayer.x_expand = true;
            this.TopLayer.x_align = Clutter.ActorAlign.FILL;
            this.TopLayer.y_expand = false;
            this.TopLayer.y_align = Clutter.ActorAlign.START;

            this.ContentLayer.x_expand = true;
            this.ContentLayer.x_align = Clutter.ActorAlign.FILL;
            this.ContentLayer.y_expand = true;
            this.ContentLayer.y_align = Clutter.ActorAlign.FILL;

            this.ControlsLayer.x_expand = true;
            this.ControlsLayer.x_align = Clutter.ActorAlign.FILL;
            this.ControlsLayer.y_expand = false;
            this.ControlsLayer.y_align = Clutter.ActorAlign.END;

            // Збирання вікна
            this.add_child(this.TopLayer);
            this.add_child(this.ContentLayer);
            this.add_child(this.ControlsLayer);

            // Колір активної/неактивної частин прогрес-бару й скролбару
            // лірики має підпорядковуватись тому ж правилу теми, що й самі
            // кнопки керування (їхні symbolic-іконки St.Icon автоматично
            // перефарбовуються GNOME Shell між світлою й темною темою) —
            // тож просто читаємо той самий колір із теми замість того, щоб
            // дублювати логіку визначення світла/темна.
            this._themeContext = St.ThemeContext.get_for_stage(global.stage);
            this._themeChangedId = this._themeContext.connect(
                "changed",
                () => this._applyAccentColor(),
            );

            // На момент _init віджети ще не змаповані на сцену — читати
            // theme-node прямо зараз ризиковано (може повернути
            // непрофарбоване/дефолтне значення), тож відкладаємо на
            // наступний idle-цикл, а також на кожне відкриття попапу
            // (гарантовано вже змаповано й актуально).
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._applyAccentColor();
                return GLib.SOURCE_REMOVE;
            });

            if (this._indicator?.menu) {
                this._indicator.menu.connect(
                    "open-state-changed",
                    (_menu, isOpen) => {
                        if (isOpen) this._applyAccentColor();
                    },
                );
            }

            this.connect("destroy", () => {
                if (this._themeChangedId && this._themeContext) {
                    this._themeContext.disconnect(this._themeChangedId);
                    this._themeChangedId = null;
                }
            });
        }

        /**
         * Зчитує колір, яким GNOME Shell фарбує symbolic-іконки кнопок
         * керування в поточній темі (світлій/темній), і розводить його на
         * два варіанти: 100% альфи (активна частина прогрес-бару й
         * скролбар лірики) та 50% альфи (неактивна частина прогрес-бару).
         */
        _applyAccentColor() {
            const probe = this.ControlsLayer?.PreviousButton?.child;
            if (!probe) return;

            const color = probe.get_theme_node().get_foreground_color();
            const activeColor = `rgba(${color.red}, ${color.green}, ${color.blue}, 1)`;
            const inactiveColor = `rgba(${color.red}, ${color.green}, ${color.blue}, 0.5)`;

            this.ControlsLayer.setAccentColor(activeColor, inactiveColor);
            this.ContentLayer.setAccentColor(activeColor);
        }

        _toggleFavorite() {
            this._isFavorited = !this._isFavorited;
            this.TopLayer.updateFavoriteState(this._isFavorited);
        }

        async _toggleLyrics() {
            if (this._isFetchingLyrics) return;

            if (this._isShowingLyrics) {
                this._isShowingLyrics = false;
                this.ContentLayer.hideLyrics();
            } else {
                this._isFetchingLyrics = true;
                this.TopLayer.setLyricsOpacity(128);

                const lyrics = await fetchLyrics(
                    this._currentArtist,
                    this._currentTitle,
                );

                this._isFetchingLyrics = false;
                this.TopLayer.setLyricsOpacity(255);

                if (lyrics) {
                    this._isShowingLyrics = true;

                    // Змінений, безпечніший підхід до розрахунку висоти вікна
                    let maxScrollHeight = 500;
                    const monitor =
                        Main.layoutManager.findMonitorForActor(this) ||
                        Main.layoutManager.primaryMonitor;

                    if (monitor) {
                        // Резервуємо 85% від загальної висоти монітора як безпечний ліміт для попапу
                        const maxAllowedPopupHeight = monitor.height * 0.85;

                        const topHeight = this.TopLayer.get_height() || 0;
                        const bottomHeight =
                            this.ControlsLayer.get_height() || 0;

                        // Віднімаємо від максимуму висоту інших елементів та відступи (margins)
                        maxScrollHeight =
                            maxAllowedPopupHeight -
                            topHeight -
                            bottomHeight -
                            48;

                        // Встановлюємо мінімальний гарантований поріг
                        if (maxScrollHeight < 150) maxScrollHeight = 150;
                    }

                    this.ContentLayer.showLyrics(lyrics, maxScrollHeight);
                } else {
                    this.ContentLayer.showLyricsError();
                }
            }
        }

        updateInfo(metadata, appIdentifier) {
            if (!metadata) return;

            const title = metadata["xesam:title"] || "Невідомий трек";
            const artist = Array.isArray(metadata["xesam:artist"])
                ? metadata["xesam:artist"].join(", ")
                : metadata["xesam:artist"] || "Невідомий виконавець";
            const album = metadata["xesam:album"] || "Невідомий альбом";

            // Перевіряємо, чи змінилася пісня
            const isNewTrack =
                this._currentTitle !== title || this._currentArtist !== artist;

            if (isNewTrack) {
                // Оновлюємо поточні дані
                this._currentTitle = title;
                this._currentArtist = artist;

                // Скидаємо до режиму метаданих лише якщо трек інший
                if (this._isShowingLyrics) {
                    this._isShowingLyrics = false;
                    this.ContentLayer.resetToMetadata();
                }

                // Оновлюємо текст лейблів
                this.ContentLayer.updateMetadata(title, artist, album);
            }

            // Іконку плеєра оновлюємо завжди, бо вона може змінитися (наприклад, перемикання Spotify -> Chrome)
            this.TopLayer.setSourceIcon(appIdentifier);
        }

        /**
         * Оновлює заповнення прогрес-бару в ControlsLayer. Викликається
         * ззовні (indicator) — з періодичного опитування позиції, поки
         * попап відкритий.
         */
        updateProgress(positionUs, lengthUs) {
            this.ControlsLayer.updateProgress(positionUs, lengthUs);
        }
    },
);