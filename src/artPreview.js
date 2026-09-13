import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const ArtPreview = GObject.registerClass(
    { GTypeName: 'ArtPreview' },
    class ArtPreview extends St.Widget {
        _init(artUrl, settings) {
            super._init({
                name: 'art-preview-overlay',
                reactive: true,
                can_focus: true,
                visible: true,
            });

            this._settings = settings;
            this._closing = false;
            this._autocloseId = null;

            // Додаємо в uiGroup — це найвищий шар
            Main.uiGroup.add_child(this);

            this.add_constraint(new Clutter.BindConstraint({
                source: global.stage,
                coordinate: Clutter.BindCoordinate.ALL,
            }));

            this.layout_manager = new Clutter.BinLayout();

            // Фон
            this._background = new St.Widget({
                style: 'background-color: rgba(0,0,0,0.8);',
                x_expand: true,
                y_expand: true,
            });
            this.add_child(this._background);

            // Стартові дефолтні розміри (безпечний квадрат) перед асинхронним прорахунком
            let imgW = 560;
            let imgH = 560;

            // Картинка
            this._image = new St.Widget({
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                width: imgW,
                height: imgH,
                style: `
                    background-image: url("${artUrl}");
                    background-size: cover;
                    background-repeat: no-repeat;
                    background-position: center;
                    border-radius: 24px;
                `,
            });
            this.add_child(this._image);

            // Встановлюємо опорну точку для масштабування САМЕ КАРТИНКИ (по центру)
            this._image.set_pivot_point(0.5, 0.5);
            
            // Стартовий розмір картинки (50%)
            this._image.scale_x = 0.5;
            this._image.scale_y = 0.5;

            // --- ЗАПУСК АСИНХРОННОГО ОБЧИСЛЕННЯ РОЗМІРІВ ---
            this._loadDimensionsAsync(artUrl);

            // ГЛОБАЛЬНЕ ПЕРЕХОПЛЕННЯ
            this._handlerId = global.stage.connect('captured-event', (stage, event) => {
                const type = event.type();
                
                if (type === Clutter.EventType.BUTTON_PRESS || 
                   (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape)) {
                    
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            // Автоприховування (таймер)
            if (this._settings && this._settings.get_boolean("preview-autoclose")) {
                const delay = this._settings.get_int("preview-autoclose-delay") * 1000;
                this._autocloseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    this.close();
                    this._autocloseId = null;
                    return GLib.SOURCE_REMOVE;
                });
            }

            const animData = this._getAnimationData();
            
            // 1. Анімація прозорості всього віджета (фон плавно з'являється)
            this.opacity = 0;
            this.ease({
                opacity: 255,
                duration: animData.showDur,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            // 2. Анімація масштабування ТІЛЬКИ для картинки
            this._image.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                duration: animData.showDur,
                mode: animData.showMode,
            });
        }

        _loadDimensionsAsync(artUrl) {
            if (!artUrl) return;

            try {
                let file;
                if (artUrl.startsWith('file://')) {
                    file = Gio.File.new_for_uri(artUrl);
                } else if (artUrl.startsWith('/')) {
                    file = Gio.File.new_for_path(artUrl);
                }
                
                if (!file) return;

                // Читаємо вміст асинхронно у фоновому потоці GLib, не фризячи рендеринг GNOME Shell
                file.load_contents_async(null, (f, res) => {
                    try {
                        let [success, contents] = f.load_contents_finish(res);
                        if (success && contents && contents.length > 0) {
                            let loader = new GdkPixbuf.PixbufLoader();
                            loader.write(contents);
                            loader.close();
                            
                            let fullPixbuf = loader.get_pixbuf();
                            if (fullPixbuf) {
                                let width = fullPixbuf.get_width();
                                let height = fullPixbuf.get_height();
                                
                                if (width && height) {
                                    const MAX_SIZE = 560;
                                    let ratio = width / height;
                                    let imgW = MAX_SIZE;
                                    let imgH = MAX_SIZE;

                                    if (ratio > 1) { 
                                        // Ландшафтне зображення (широке)
                                        imgH = Math.round(MAX_SIZE / ratio);
                                    } else { 
                                        // Портретне зображення (постери фільмів)
                                        imgW = Math.round(MAX_SIZE * ratio);
                                    }

                                    // Безпечно оновлюємо розміри віджета, якщо користувач ще не встиг закрити прев'ю
                                    if (this._image && !this._closing) {
                                        this._image.set_size(imgW, imgH);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.warn(`[ArtPreview] Не вдалося обробити асинхронні дані обкладинки: ${e}`);
                    }
                });
            } catch (e) {
                console.warn(`[ArtPreview] Не вдалося ініціювати асинхронне читання: ${e}`);
            }
        }

        _getAnimationData() {
            const animName = this._settings ? this._settings.get_string("preview-animation") : "Ease Out Quad";
            const baseModes = {
                "Back": { show: Clutter.AnimationMode.EASE_OUT_BACK, hide: Clutter.AnimationMode.EASE_IN_BACK, def: 350 },
                "Bounce": { show: Clutter.AnimationMode.EASE_OUT_BOUNCE, hide: Clutter.AnimationMode.EASE_IN_BOUNCE, def: 500 },
                "Circ": { show: Clutter.AnimationMode.EASE_OUT_CIRC, hide: Clutter.AnimationMode.EASE_IN_CIRC, def: 300 },
                "Cubic": { show: Clutter.AnimationMode.EASE_OUT_CUBIC, hide: Clutter.AnimationMode.EASE_IN_CUBIC, def: 300 },
                "Elastic": { show: Clutter.AnimationMode.EASE_OUT_ELASTIC, hide: Clutter.AnimationMode.EASE_IN_ELASTIC, def: 800 },
                "Expo": { show: Clutter.AnimationMode.EASE_OUT_EXPO, hide: Clutter.AnimationMode.EASE_IN_EXPO, def: 400 },
                "Quad": { show: Clutter.AnimationMode.EASE_OUT_QUAD, hide: Clutter.AnimationMode.EASE_IN_QUAD, def: 250 },
                "Quart": { show: Clutter.AnimationMode.EASE_OUT_QUART, hide: Clutter.AnimationMode.EASE_IN_QUART, def: 300 },
                "Quint": { show: Clutter.AnimationMode.EASE_OUT_QUINT, hide: Clutter.AnimationMode.EASE_IN_QUINT, def: 350 },
                "Sine": { show: Clutter.AnimationMode.EASE_OUT_SINE, hide: Clutter.AnimationMode.EASE_IN_SINE, def: 200 }
            };

            const base = baseModes[animName] || baseModes["Ease Out Quad"];
            let customData = {};
            try {
                if (this._settings) {
                    customData = JSON.parse(this._settings.get_string('preview-animation-custom') || '{}');
                }
            } catch (e) { customData = {}; }

            const custom = customData[animName] || { show: base.def, hide: base.def };

            return {
                showMode: base.show,
                hideMode: base.hide,
                showDur: custom.show,
                hideDur: custom.hide
            };
        }

        close() {
            if (this._closing) return;
            this._closing = true;

            if (this._autocloseId) {
                GLib.source_remove(this._autocloseId);
                this._autocloseId = null;
            }

            if (this._handlerId) {
                global.stage.disconnect(this._handlerId);
                this._handlerId = 0;
            }

            const animData = this._getAnimationData();

            // 1. Анімація зникнення фону (прозорість)
            this.ease({
                opacity: 0,
                duration: animData.hideDur,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD, 
                onComplete: () => this.destroy(),
            });

            // 2. Анімація зменшення картинки
            this._image.ease({
                scale_x: 0.5,
                scale_y: 0.5,
                duration: animData.hideDur,
                mode: animData.hideMode,
            });
        }

        destroy() {
            if (this._handlerId) {
                global.stage.disconnect(this._handlerId);
            }
            if (this._autocloseId) {
                GLib.source_remove(this._autocloseId);
            }
            super.destroy();
        }
    }
);