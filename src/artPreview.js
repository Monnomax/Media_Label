import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    buildArtworkCandidates,
    fitArtworkToScreen,
    isArtworkResolutionEnough,
    getRequiredSourceWidth,
    findNextSuitableTmdbCandidate,
    getYouTubeMinimumWidth,
    escapeCssUrl,
} from "./artworkUtils.js";

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
                    background-image: none;
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
            const {
                candidates,
                isYouTubeThumbnail,
                isTmdbArtwork,
            } = buildArtworkCandidates(artUrl);

            const monitor = Main.layoutManager.primaryMonitor;
            const stageWidth = Math.max(
                1,
                (monitor && monitor.width) || global.stage.width || 1366,
            );
            const stageHeight = Math.max(
                1,
                (monitor && monitor.height) || global.stage.height || 768,
            );
            const fitToScreen = (width, height) =>
                fitArtworkToScreen(width, height, stageWidth, stageHeight);

            // Cache downloaded bytes so CSS can load the local file rather than
            // fetching the same remote candidate a second time. Keep the cache bounded.
            const trimArtworkCache = (cacheDir, protectedPath) => {
                try {
                    const dir = Gio.File.new_for_path(cacheDir);
                    const enumerator = dir.enumerate_children(
                        'standard::name,time::modified',
                        Gio.FileQueryInfoFlags.NONE,
                        null,
                    );
                    const entries = [];
                    let info;
                    while ((info = enumerator.next_file(null)) !== null) {
                        const name = info.get_name();
                        if (!/^[a-f0-9]{64}\.[a-z0-9]+$/i.test(name)) continue;
                        entries.push({
                            file: dir.get_child(name),
                            path: GLib.build_filenamev([cacheDir, name]),
                            modified: Number(info.get_attribute_uint64('time::modified')) || 0,
                        });
                    }
                    enumerator.close(null);
                    entries.sort((a, b) => b.modified - a.modified);
                    for (const entry of entries.slice(64)) {
                        if (entry.path === protectedPath) continue;
                        try {
                            entry.file.delete(null);
                        } catch (e) {
                            // A stale cache entry is not required for preview correctness.
                        }
                    }
                } catch (e) {
                    // Cache pruning is best-effort; it must not prevent a preview.
                }
            };

            const cacheArtworkContents = (candidate, contents) => {
                const cacheDir = GLib.build_filenamev([
                    GLib.get_user_cache_dir(),
                    'media-label',
                    'artwork-preview',
                ]);
                GLib.mkdir_with_parents(cacheDir, 0o700);

                // Hash the bytes, not only the URL: if a server updates an image
                // at the same URL, its cache filename changes and Shell cannot reuse
                // a stale texture under the previous local URI.
                const checksum = GLib.compute_checksum_for_data(
                    GLib.ChecksumType.SHA256,
                    contents,
                    contents.length,
                );
                const withoutQuery = candidate.split(/[?#]/, 1)[0];
                const extensionMatch = withoutQuery.match(/\.(jpe?g|png|webp|gif|avif)$/i);
                let extension = extensionMatch
                    ? extensionMatch[1].toLowerCase().replace('jpeg', 'jpg')
                    : null;

                // Some Chromium/NW.js MPRIS art files have no extension. Detect their
                // common raster signatures so the CSS image loader gets a useful suffix.
                if (!extension && contents && contents.length >= 12) {
                    if (
                        contents[0] === 0x89 && contents[1] === 0x50 &&
                        contents[2] === 0x4e && contents[3] === 0x47
                    ) extension = 'png';
                    else if (contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff)
                        extension = 'jpg';
                    else if (
                        contents[0] === 0x52 && contents[1] === 0x49 &&
                        contents[2] === 0x46 && contents[3] === 0x46 &&
                        contents[8] === 0x57 && contents[9] === 0x45 &&
                        contents[10] === 0x42 && contents[11] === 0x50
                    ) extension = 'webp';
                    else if (
                        contents[0] === 0x47 && contents[1] === 0x49 &&
                        contents[2] === 0x46 && contents[3] === 0x38
                    ) extension = 'gif';
                }

                extension = extension || 'img';
                const cachedPath = GLib.build_filenamev([cacheDir, `${checksum}.${extension}`]);
                const cachedFile = Gio.File.new_for_path(cachedPath);
                cachedFile.replace_contents(
                    contents,
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
                    null,
                );
                trimArtworkCache(cacheDir, cachedPath);
                return cachedFile.get_uri();
            };

            const displayCandidate = (artwork) => {
                if (this._closing || !this._image || !artwork) return;

                let displayUrl = artwork.candidate;
                try {
                    displayUrl = cacheArtworkContents(artwork.candidate, artwork.contents);
                } catch (e) {
                    log(`Media Label: could not cache preview image; using source URL: ${e.message}`);
                }

                const safeUrl = escapeCssUrl(displayUrl);
                this._image.set_style(`
                    background-image: url("${safeUrl}");
                    background-size: contain;
                    background-repeat: no-repeat;
                    background-position: center;
                    border-radius: 24px;
                `);
                const size = fitToScreen(artwork.width, artwork.height);
                this._image.set_size(size.width, size.height);
            };

            let bestAvailable = null;

            const tryCandidate = (index) => {
                if (this._closing || !this._image) return;
                if (index >= candidates.length) {
                    // Larger candidates may fail; use the best image that did load.
                    if (bestAvailable) displayCandidate(bestAvailable);
                    return;
                }

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

                            const displaySize = fitToScreen(width, height);

                            // Reject tiny YouTube placeholder images before they become fallback candidates.
                            if (isYouTubeThumbnail) {
                                const minimumWidth = getYouTubeMinimumWidth(candidate);
                                if (width < minimumWidth) {
                                    tryCandidate(index + 1);
                                    return;
                                }
                            }

                            const currentArtwork = {
                                candidate,
                                width,
                                height,
                                contents,
                            };

                            // Keep the highest-resolution successful image so a failed escalation
                            // never leaves the preview blank when a usable smaller image exists.
                            if (
                                !bestAvailable ||
                                width * height > bestAvailable.width * bestAvailable.height
                            ) {
                                bestAvailable = currentArtwork;
                            }

                            if (
                                isTmdbArtwork &&
                                !isArtworkResolutionEnough(width, height, displaySize, 1.05)
                            ) {
                                const neededSourceWidth = getRequiredSourceWidth(
                                    width,
                                    height,
                                    displaySize,
                                    1.05,
                                );
                                const nextSuitableIndex = findNextSuitableTmdbCandidate(
                                    candidates,
                                    index,
                                    neededSourceWidth,
                                );

                                if (nextSuitableIndex >= 0) {
                                    tryCandidate(nextSuitableIndex);
                                    return;
                                }
                                // No larger candidate is available; show the best one already loaded.
                                displayCandidate(bestAvailable);
                                return;
                            }

                            // Render from the downloaded bytes via a local cache URL. This avoids
                            // another network fetch when the CSS background is decoded by St.
                            displayCandidate(currentArtwork);
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
                "Linear": { show: Clutter.AnimationMode.LINEAR, hide: Clutter.AnimationMode.LINEAR, def: 300 },
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
