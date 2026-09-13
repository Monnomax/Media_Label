import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";

/**
 * Оверлей візуалізації перемотування треку.
 *
 * Живе в тому самому "стеку" (Clutter.BinLayout), що й TrackLabel, і
 * повністю дублює його виділену площу (сам НЕ бере участі в розрахунку
 * preferred-розміру контейнера — vfunc_get_preferred_width навмисно
 * повертає [0, 0], тому ширина кнопки лишається такою, якою її задає
 * TrackLabel; саме x_align/y_align: FILL у _init змушує BinLayout
 * розтягнути цей віджет на весь той самий box незалежно від його
 * власного preferred-розміру — expand сам по собі на це не впливає).
 *
 * Показує:
 *  - прогрес-бар на всю ширину і всю висоту виділеної області (сірий фон +
 *    акцентна заповнена частина зліва направо)
 *  - таймкод "hh.mm.ss / hh.mm.ss" (або "mm.ss" для коротких треків)
 *    по центру, поверх бару, кольором тексту назви треку. Якщо таймкод
 *    природно ширший за поточну ширину кнопки, indicator підтягує ширину
 *    через TrackLabel.growToFit(getRequiredWidth()) тією ж анімацією, що
 *    й при зміні треку — тоді центр таймкоду й лівий край назви фактично
 *    збігаються, бо box звужується/розширюється точно під його текст.
 */
export const SeekOverlay = GObject.registerClass(
    { GTypeName: "SeekOverlay" },
    class SeekOverlay extends St.Widget {
        _init() {
            super._init({
                style_class: "mpris-seek-overlay",
                clip_to_allocation: true,
                y_align: Clutter.ActorAlign.FILL,
                x_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
                reactive: false,
                can_focus: false,
                opacity: 0,
                visible: false,
            });

            this._isDestroyed = false;

            this._label = new St.Label({
                text: "00.00 / 00.00",
                style_class: "mpris-seek-timecode",
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
            });
            this.add_child(this._label);

            this.connect("destroy", () => {
                this._isDestroyed = true;
            });
        }

        // Навмисно [0, 0]: контейнер-стек не повинен рахувати ширину
        // оверлею при визначенні власного preferred-розміру — це робить
        // виключно TrackLabel, щоб ширина кнопки не "стрибала".
        vfunc_get_preferred_width(forHeight) {
            return [0, 0];
        }

        vfunc_get_preferred_height(forWidth) {
            return this._label.get_preferred_height(forWidth);
        }

        vfunc_allocate(box) {
            this.set_allocation(box);

            const width = box.get_width();
            const height = box.get_height();

            const [, natWidth] = this._label.get_preferred_width(-1);
            const [, natHeight] = this._label.get_preferred_height(-1);
            const labelBox = new Clutter.ActorBox();
            labelBox.x1 = Math.round((width - natWidth) / 2);
            labelBox.y1 = Math.round((height - natHeight) / 2);
            labelBox.x2 = labelBox.x1 + natWidth;
            labelBox.y2 = labelBox.y1 + natHeight;
            this._label.allocate(labelBox);
        }

        /**
         * Природна ширина поточного тексту таймкоду — використовується
         * indicator'ом, щоб при потребі розширити TrackLabel/кнопку так
         * само, як це робиться при зміні треку.
         */
        getRequiredWidth() {
            if (this._isDestroyed || !this._label) return 0;
            const [, natWidth] = this._label.get_preferred_width(-1);
            return natWidth;
        }

        /**
         * Колір тексту таймкоду — той самий, що й у назви треку
         * (this._palette.text у індикаторі). null скидає колір до дефолтного.
         */
        setColors(accentColor, textColor) {
            if (this._isDestroyed) return;

            if (textColor) {
                this._label.set_style(
                    `color: rgb(${textColor.r}, ${textColor.g}, ${textColor.b});`,
                );
            } else {
                this._label.set_style(null);
            }
        }

        updateProgress(positionUs, lengthUs) {
            if (this._isDestroyed) return;

            const length = Math.max(0, lengthUs || 0);
            const pos = Math.max(
                0,
                Math.min(positionUs || 0, length || Number.MAX_SAFE_INTEGER),
            );
            const showHours = Math.floor(length / 1_000_000) >= 3600;

            this._label.set_text(
                `${this._formatTime(pos, showHours)} / ${this._formatTime(length, showHours)}`,
            );
            this.queue_relayout();
        }

        _formatTime(us, showHours) {
            const totalSec = Math.max(0, Math.floor(us / 1_000_000));
            const hours = Math.floor(totalSec / 3600);
            const min = Math.floor((totalSec % 3600) / 60);
            const sec = totalSec % 60;

            if (showHours)
                return `${hours.toString().padStart(2, "0")}.${min.toString().padStart(2, "0")}.${sec.toString().padStart(2, "0")}`;

            return `${min.toString().padStart(2, "0")}.${sec.toString().padStart(2, "0")}`;
        }
    },
);
