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
                    background-size: contain;
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
            if (!artUrl || !this._image) return;

            // Спочатку пробуємо найбільші відомі варіанти. Якщо CDN їх не має,
            // послідовно переходимо до меншого варіанта й наприкінці — до URL MPRIS.
            const candidates = [];
            const addCandidate = (url) => {
                if (url && !candidates.includes(url)) candidates.push(url);
            };
            let isYouTubeThumbnail = false;
            const youtubeMatch = artUrl.match(
                /^(https?:\/\/(?:i\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/[^/]+\/)([^/?#]+)(\.(?:jpg|jpeg|png|webp))(?:[?#].*)?$/i,
            );

            if (youtubeMatch) {
                isYouTubeThumbnail = true;
                const prefix = youtubeMatch[1];
                const extension = youtubeMatch[3];
                addCandidate(`${prefix}maxresdefault${extension}`);
                addCandidate(`${prefix}sddefault${extension}`);
                addCandidate(`${prefix}hqdefault${extension}`);
                addCandidate(`${prefix}mqdefault${extension}`);
                addCandidate(`${prefix}default${extension}`);
            }

            // TMDB офіційно підтримує розмір original; якщо він недоступний,
            // перевіряємо типові великі розміри й лише тоді повертаємося до MPRIS URL.
            const tmdbMatch = artUrl.match(
                /^(https?:\/\/image\.tmdb\.org\/t\/p\/)([^/]+)(\/[^?#]+)([?#].*)?$/i,
            );
            if (tmdbMatch) {
                const base = tmdbMatch[1];
                const path = tmdbMatch[3];
                const query = tmdbMatch[4] || '';
                for (const size of ['original', 'w1280', 'w780', 'w500', 'w342', 'w185'])
                    addCandidate(`${base}${size}${path}${query}`);
            }

            // YouTube Music та деякі інші сервіси використовують Google image CDN,
            // де розмір заданий суфіксом на кшталт =w120-h120-l90-rj.
            const googleHost = /^https?:\/\/(?:yt3\.ggpht\.com|lh\d+\.googleusercontent\.com)\//i.test(artUrl);
            if (googleHost) {
                const suffixMatch = artUrl.match(/^(https?:\/\/[^?#]+?)(?:=w\d+-h\d+[^/?#]*|=s\d+[^/?#]*)([?#].*)?$/i);
                if (suffixMatch) {
                    const base = suffixMatch[1];
                    const query = suffixMatch[2] || '';
                    addCandidate(`${base}=w1600-h1600${query}`);
                    addCandidate(`${base}=w1200-h1200${query}`);
                    addCandidate(`${base}=w800-h800${query}`);
                }
            }

            addCandidate(artUrl);

            const fitToScreen = (width, height) => {
                // Межі прев'ю: 50 px з кожного боку монітора.
                // Визначаємо саме розмір монітора, а не роздільну здатність
                // початкової мініатюри: невеликі зображення також масштабуються.
                const monitor = Main.layoutManager.primaryMonitor;
                const stageWidth = Math.max(
                    1,
                    (monitor && monitor.width) || global.stage.width || 1366,
                );
                const stageHeight = Math.max(
                    1,
                    (monitor && monitor.height) || global.stage.height || 768,
                );
                const margin = 50;
                const maxWidth = Math.max(1, stageWidth - margin * 2);
                const maxHeight = Math.max(1, stageHeight - margin * 2);

                // Не обмежуємо коефіцієнт одиницею: мініатюри збільшуються
                // до максимальної області, зберігаючи співвідношення сторін.
                const scale = Math.min(maxWidth / width, maxHeight / height);
                return {
                    width: Math.max(1, Math.round(width * scale)),
                    height: Math.max(1, Math.round(height * scale)),
                };
            };

            const tryCandidate = (index) => {
                if (this._closing || !this._image || index >= candidates.length) return;

                const candidate = candidates[index];
                let file;
                try {
                    file = candidate.startsWith('/')
                        ? Gio.File.new_for_path(candidate)
                        : Gio.File.new_for_uri(candidate);
                    file.load_contents_async(null, (f, res) => {
                        if (this._closing || !this._image) return;
                        try {
                            const [success, contents] = f.load_contents_finish(res);
                            if (!success || !contents || contents.length === 0) {
                                tryCandidate(index + 1);
                                return;
                            }

                            const loader = new GdkPixbuf.PixbufLoader();
                            loader.write(contents);
                            loader.close();
                            const pixbuf = loader.get_pixbuf();
                            if (!pixbuf) {
                                tryCandidate(index + 1);
                                return;
                            }

                            const width = pixbuf.get_width();
                            const height = pixbuf.get_height();
                            if (!width || !height) {
                                tryCandidate(index + 1);
                                return;
                            }

                            // maxresdefault іноді повертає маленький placeholder замість
                            // помилки HTTP. Не приймаємо його за якісний thumbnail.
                            if (isYouTubeThumbnail) {
                                const minimumWidth = candidate.includes('/maxresdefault.') ? 800
                                    : candidate.includes('/sddefault.') ? 500
                                    : candidate.includes('/hqdefault.') ? 320
                                    : candidate.includes('/mqdefault.') ? 200
                                    : 1;
                                if (width < minimumWidth) {
                                    tryCandidate(index + 1);
                                    return;
                                }
                            }

                            const safeUrl = candidate
                                .replace(/\\/g, '\\\\')
                                .replace(/"/g, '\\"');
                            this._image.set_style(`
                                background-image: url("${safeUrl}");
                                background-size: contain;
                                background-repeat: no-repeat;
                                background-position: center;
                                border-radius: 24px;
                            `);

                            const size = fitToScreen(width, height);
                            this._image.set_size(size.width, size.height);
                        } catch (e) {
                            // Кандидат не є придатним зображенням або не читається — пробуємо наступний.
                            tryCandidate(index + 1);
                        }
                    });
                } catch (e) {
                    tryCandidate(index + 1);
                }
            };

            tryCandidate(0);
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