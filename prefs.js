import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

function getControlsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: "Керування",
        icon_name: "preferences-system-symbolic",
    });

    const group = new Adw.PreferencesGroup({
        title: "Функції кнопок миші",
    });

    const grid = new Gtk.Grid({
        column_spacing: 32,
        row_spacing: 16,
        halign: Gtk.Align.CENTER,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });

    const cardContainer = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        css_classes: ["card"],
        margin_top: 6,
        margin_bottom: 6,
    });
    cardContainer.append(grid);

    const actionOptions = [
        "Нічого",
        "Play/Pause",
        "Next",
        "Previous",
        "Перемотування вперед",
        "Перемотування назад",
        "Відкриття прев'ю",
    ];

    const singleLabel = new Gtk.Label({
        label: "Single",
        css_classes: ["dim-label"],
    });
    const doubleLabel = new Gtk.Label({
        label: "Double",
        css_classes: ["dim-label"],
    });
    const holdLabel = new Gtk.Label({
        label: "Hold",
        css_classes: ["dim-label"],
    });

    grid.attach(singleLabel, 1, 0, 1, 1);
    grid.attach(doubleLabel, 2, 0, 1, 1);
    grid.attach(holdLabel, 3, 0, 1, 1);

    const rows = [
        ["Mouse-1.svg", true],
        ["Mouse-2.svg", true],
        ["Mouse-3.svg", true],
        ["Mouse-4.svg", false],
        ["Mouse-5.svg", false],
    ];

    const homeDir = GLib.get_home_dir();
    const iconsBasePath = `${homeDir}/Extensions/media-label@local/resources/icons`;

    for (let i = 0; i < rows.length; i++) {
        const [iconName, hasFullControls] = rows[i];
        const rowIdx = i + 1;

        const iconPath = `${iconsBasePath}/${iconName}`;
        const image = Gtk.Image.new_from_file(iconPath);
        image.set_pixel_size(32);
        grid.attach(image, 0, rowIdx, 1, 1);

        const singleModel = new Gtk.StringList();
        actionOptions.forEach((action) => singleModel.append(action));
        const singleDropdown = new Gtk.DropDown({ model: singleModel });
        grid.attach(singleDropdown, 1, rowIdx, 1, 1);

        if (hasFullControls) {
            const doubleModel = new Gtk.StringList();
            actionOptions.forEach((action) => doubleModel.append(action));
            const doubleDropdown = new Gtk.DropDown({ model: doubleModel });
            grid.attach(doubleDropdown, 2, rowIdx, 1, 1);

            const holdModel = new Gtk.StringList();
            actionOptions.forEach((action) => holdModel.append(action));
            const holdDropdown = new Gtk.DropDown({ model: holdModel });
            grid.attach(holdDropdown, 3, rowIdx, 1, 1);
        }
    }

    group.add(cardContainer);
    page.add(group);

    const seekGroup = new Adw.PreferencesGroup({
        title: "Перемотування",
    });

    const createSeekButton = (
        key,
        { lower, upper, step_increment = 1, divisor = 1, decimals = 0 } = {},
    ) => {
        const formatValue = (rawValue) => {
            const valueInSeconds = rawValue / divisor;
            return Number(valueInSeconds).toFixed(decimals);
        };

        const button = new Gtk.Button({
            label: formatValue(settings.get_int(key)),
            valign: Gtk.Align.CENTER,
        });
        button.set_size_request(72, -1);

        const clampValue = (value) =>
            Math.max(lower, Math.min(upper, Number(value.toFixed(decimals))));
        const setConfigValue = (value) => {
            const secondsValue = clampValue(value);
            settings.set_int(key, Math.round(secondsValue * divisor));
        };

        const scrollCtrl = new Gtk.EventControllerScroll({
            flags:
                Gtk.EventControllerScrollFlags.VERTICAL |
                Gtk.EventControllerScrollFlags.HORIZONTAL,
        });
        scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
            const current = settings.get_int(key) / divisor;
            if (dy < 0 || dx < 0) {
                setConfigValue(current + step_increment);
            } else if (dy > 0 || dx > 0) {
                setConfigValue(current - step_increment);
            }
            return true;
        });
        button.add_controller(scrollCtrl);

        settings.connect(`changed::${key}`, () => {
            button.label = formatValue(settings.get_int(key));
        });

        return button;
    };

    const seekStepRow = new Adw.ActionRow({
        title: "Крок перемотування",
    });
    const seekStepButton = createSeekButton("seek-step", {
        lower: 1,
        upper: 120,
        step_increment: 1,
        divisor: 1_000_000,
    });
    seekStepRow.add_suffix(seekStepButton);
    seekStepRow.activatable_widget = seekStepButton;
    seekGroup.add(seekStepRow);

    const seekTimecodeRow = new Adw.ActionRow({
        title: "Тривалість відображення таймкоду",
    });
    const seekTimecodeButton = createSeekButton("seek-timecode-duration", {
        lower: 1,
        upper: 10,
        step_increment: 1,
        divisor: 1000,
    });
    seekTimecodeRow.add_suffix(seekTimecodeButton);
    seekTimecodeRow.activatable_widget = seekTimecodeButton;
    seekGroup.add(seekTimecodeRow);

    page.add(seekGroup);

    return page;
}

export default class MprisLabelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const createNumericButton = (
            key,
            { lower, upper, step_increment = 1 } = {},
        ) => {
            const button = new Gtk.Button({
                label: settings.get_int(key).toString(),
                valign: Gtk.Align.CENTER,
            });
            button.set_size_request(72, -1);

            const clampValue = (value) =>
                Math.max(lower, Math.min(upper, Math.round(value)));
            const setConfigValue = (value) => {
                settings.set_int(key, clampValue(value));
            };

            const scrollCtrl = new Gtk.EventControllerScroll({
                flags:
                    Gtk.EventControllerScrollFlags.VERTICAL |
                    Gtk.EventControllerScrollFlags.HORIZONTAL,
            });
            scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
                const current = settings.get_int(key);
                if (dy < 0 || dx < 0) {
                    setConfigValue(current + step_increment);
                } else if (dy > 0 || dx > 0) {
                    setConfigValue(current - step_increment);
                }
                return true;
            });
            button.add_controller(scrollCtrl);

            settings.connect(`changed::${key}`, () => {
                button.label = settings.get_int(key).toString();
            });

            return button;
        };

        const createScrollButton = (
            initialValue,
            { lower, upper, step_increment = 1 },
            onChanged,
        ) => {
            const button = new Gtk.Button({
                label: String(initialValue),
                valign: Gtk.Align.CENTER,
            });
            button.set_size_request(72, -1);

            const clampValue = (value) =>
                Math.max(lower, Math.min(upper, Math.round(value)));
            const scrollCtrl = new Gtk.EventControllerScroll({
                flags:
                    Gtk.EventControllerScrollFlags.VERTICAL |
                    Gtk.EventControllerScrollFlags.HORIZONTAL,
            });
            scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
                let current = parseInt(button.label, 10);
                if (Number.isNaN(current)) current = lower;
                if (dy < 0 || dx < 0) {
                    current += step_increment;
                } else if (dy > 0 || dx > 0) {
                    current -= step_increment;
                }
                current = clampValue(current);
                button.label = current.toString();
                onChanged(current);
                return true;
            });
            button.add_controller(scrollCtrl);
            return button;
        };

        const page = new Adw.PreferencesPage({
            title: "Лейбл",
            icon_name: "document-metadata-symbolic",
        });
        window.add(page);

        const artGroup = new Adw.PreferencesGroup({
            title: "Обкладинка альбому",
        });
        page.add(artGroup);

        const radiusRow = new Adw.ActionRow({
            title: "Радіус заокруглення кутів",
        });
        const radiusButton = createNumericButton("album-radius", {
            lower: 0,
            upper: 30,
            step_increment: 1,
        });
        radiusRow.add_suffix(radiusButton);
        radiusRow.activatable_widget = radiusButton;
        artGroup.add(radiusRow);

        const displayModeGroup = new Adw.PreferencesGroup({
            title: "Режим відображення",
        });
        page.add(displayModeGroup);

        const displayModeNames = [
            "Тільки обкладинку",
            "Тільки текст",
            "Обкладинку та текст",
        ];

        const displayModeRow = new Adw.ActionRow({
            title: "Показувати",
        });
        const displayModeDropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(displayModeNames),
            selected: settings.get_int("display-mode"),
            valign: Gtk.Align.CENTER,
        });
        displayModeRow.add_suffix(displayModeDropdown);
        displayModeRow.activatable_widget = displayModeDropdown;
        displayModeGroup.add(displayModeRow);

        displayModeDropdown.connect("notify::selected", () => {
            if (
                settings.get_int("display-mode") !==
                displayModeDropdown.selected
            ) {
                settings.set_int("display-mode", displayModeDropdown.selected);
            }
        });

        settings.connect("changed::display-mode", () => {
            const value = settings.get_int("display-mode");
            if (value !== displayModeDropdown.selected) {
                displayModeDropdown.selected = value;
            }
        });

        const colorGroup = new Adw.PreferencesGroup({
            title: "Колір кнопки",
        });
        page.add(colorGroup);

        const autoColorRow = new Adw.SwitchRow({
            title: "Адаптивний колір кнопки",
        });
        settings.bind(
            "auto-color",
            autoColorRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        colorGroup.add(autoColorRow);

        const intensityRow = new Adw.ActionRow({
            title: "Інтенсивність кольору",
        });
        const intensityButton = createNumericButton("color-intensity", {
            lower: 0,
            upper: 100,
            step_increment: 5,
        });
        intensityRow.add_suffix(intensityButton);
        colorGroup.add(intensityRow);

        const layoutGroup = new Adw.PreferencesGroup({
            title: "Розміри та відступи",
        });
        page.add(layoutGroup);

        const widthRow = new Adw.ActionRow({
            title: "Максимальна ширина тексту",
        });
        const widthButton = createNumericButton("button-width", {
            lower: 200,
            upper: 500,
            step_increment: 10,
        });
        widthRow.add_suffix(widthButton);
        widthRow.activatable_widget = widthButton;
        layoutGroup.add(widthRow);

        const leftPaddingRow = new Adw.ActionRow({
            title: "Відступ зліва",
        });
        const leftPaddingButton = createNumericButton("padding-left", {
            lower: 0,
            upper: 50,
            step_increment: 1,
        });
        leftPaddingRow.add_suffix(leftPaddingButton);
        leftPaddingRow.activatable_widget = leftPaddingButton;
        layoutGroup.add(leftPaddingRow);

        const rightPaddingRow = new Adw.ActionRow({
            title: "Відступ справа",
        });
        const rightPaddingButton = createNumericButton("padding-right", {
            lower: 0,
            upper: 50,
            step_increment: 1,
        });
        rightPaddingRow.add_suffix(rightPaddingButton);
        rightPaddingRow.activatable_widget = rightPaddingButton;
        layoutGroup.add(rightPaddingRow);

        const buttonPositionGroup = new Adw.PreferencesGroup({
            title: "Позиція кнопки",
        });
        page.add(buttonPositionGroup);

        const positionNames = ["Зліва", "По центру", "Справа"];
        let positionIdx = settings.get_int("panel-position");
        if (positionIdx < 0 || positionIdx >= positionNames.length)
            positionIdx = 0;

        const positionRow = new Adw.ActionRow({
            title: "Позиція на панелі",
        });
        const positionDropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(positionNames),
            selected: positionIdx,
            valign: Gtk.Align.CENTER,
        });
        positionRow.add_suffix(positionDropdown);
        buttonPositionGroup.add(positionRow);

        positionDropdown.connect("notify::selected", () => {
            if (
                settings.get_int("panel-position") !== positionDropdown.selected
            ) {
                settings.set_int("panel-position", positionDropdown.selected);
            }
        });

        settings.connect("changed::panel-position", () => {
            const selectedIdx = settings.get_int("panel-position");
            if (selectedIdx !== positionDropdown.selected) {
                positionDropdown.selected = selectedIdx;
            }
        });

        const indexRow = new Adw.ActionRow({
            title: "Порядок у черзі",
        });
        const indexButton = createNumericButton("panel-index", {
            lower: 0,
            upper: 20,
            step_increment: 1,
        });
        indexRow.add_suffix(indexButton);
        buttonPositionGroup.add(indexRow);

        const marqueeGroup = new Adw.PreferencesGroup({
            title: "Налаштування прокручування тексту",
        });
        page.add(marqueeGroup);

        const marqueeSpeedRow = new Adw.ActionRow({
            title: "Швидкість прокручування тексту",
        });
        const marqueeSpeedButton = createNumericButton("marquee-speed", {
            lower: 10,
            upper: 100,
            step_increment: 10,
        });
        marqueeSpeedRow.add_suffix(marqueeSpeedButton);
        marqueeSpeedRow.activatable_widget = marqueeSpeedButton;
        marqueeGroup.add(marqueeSpeedRow);

        const marqueeDelayStartRow = new Adw.ActionRow({
            title: "Тривалість очікування на початку",
        });
        const marqueeDelayStartButton = createNumericButton(
            "marquee-delay-start",
            {
                lower: 0,
                upper: 5000,
                step_increment: 50,
            },
        );
        marqueeDelayStartRow.add_suffix(marqueeDelayStartButton);
        marqueeDelayStartRow.activatable_widget = marqueeDelayStartButton;
        marqueeGroup.add(marqueeDelayStartRow);

        const marqueeDelayEndRow = new Adw.ActionRow({
            title: "Тривалість очікування в кінці",
        });
        const marqueeDelayEndButton = createNumericButton("marquee-delay-end", {
            lower: 0,
            upper: 5000,
            step_increment: 50,
        });
        marqueeDelayEndRow.add_suffix(marqueeDelayEndButton);
        marqueeDelayEndRow.activatable_widget = marqueeDelayEndButton;
        marqueeGroup.add(marqueeDelayEndRow);

        const settingsGroup = new Adw.PreferencesGroup({
            title: "Налаштування",
        });
        page.add(settingsGroup);

        const settingsActionsRow = new Adw.ActionRow({
            title: "Дії з налаштуваннями",
        });
        settingsGroup.add(settingsActionsRow);

        const settingsButtonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
            homogeneous: true,
        });

        const importButton = new Gtk.Button({ label: "Імпорт" });
        const exportButton = new Gtk.Button({ label: "Експорт" });
        const resetButton = new Gtk.Button({
            label: "Скинути",
            css_classes: ["destructive-action"],
        });

        settingsButtonBox.append(importButton);
        settingsButtonBox.append(exportButton);
        settingsButtonBox.append(resetButton);

        settingsActionsRow.add_suffix(settingsButtonBox);

        const showSettingsErrorDialog = (message) => {
            const errorDialog = new Adw.MessageDialog({
                transient_for: window,
                heading: "Помилка",
                body: message,
            });
            errorDialog.add_response("ok", "Гаразд");
            errorDialog.present();
        };

        exportButton.connect("clicked", () => {
            const fileDialog = new Gtk.FileDialog({
                title: "Експортувати налаштування",
                initial_name: "mpris-label-settings.json",
            });

            fileDialog.save(window, null, (dlg, result) => {
                let file;
                try {
                    file = dlg.save_finish(result);
                } catch (e) {
                    return;
                }
                if (!file) return;

                try {
                    const keys = settings.settings_schema.list_keys();
                    const data = {};
                    keys.forEach((key) => {
                        data[key] = settings.get_value(key).deep_unpack();
                    });
                    const jsonStr = JSON.stringify(data, null, 2);
                    file.replace_contents(
                        new TextEncoder().encode(jsonStr),
                        null,
                        false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION,
                        null,
                    );
                } catch (e) {
                    logError(e);
                    showSettingsErrorDialog(
                        "Не вдалося зберегти файл налаштувань.",
                    );
                }
            });
        });

        importButton.connect("clicked", () => {
            const fileDialog = new Gtk.FileDialog({
                title: "Імпортувати налаштування",
            });

            const jsonFilter = new Gtk.FileFilter();
            jsonFilter.set_name("JSON файли");
            jsonFilter.add_pattern("*.json");
            const filterStore = new Gio.ListStore({
                item_type: Gtk.FileFilter,
            });
            filterStore.append(jsonFilter);
            fileDialog.set_filters(filterStore);
            fileDialog.set_default_filter(jsonFilter);

            fileDialog.open(window, null, (dlg, result) => {
                let file;
                try {
                    file = dlg.open_finish(result);
                } catch (e) {
                    return;
                }
                if (!file) return;

                try {
                    const [success, contents] = file.load_contents(null);
                    if (!success) {
                        showSettingsErrorDialog(
                            "Не вдалося прочитати файл налаштувань.",
                        );
                        return;
                    }
                    const jsonStr = new TextDecoder().decode(contents);
                    const data = JSON.parse(jsonStr);
                    const validKeys = settings.settings_schema.list_keys();

                    Object.keys(data).forEach((key) => {
                        if (!validKeys.includes(key)) return;
                        try {
                            const currentValue = settings.get_value(key);
                            const variantType = currentValue.get_type_string();
                            const newValue = new GLib.Variant(
                                variantType,
                                data[key],
                            );
                            settings.set_value(key, newValue);
                        } catch (e) {
                            logError(e);
                        }
                    });
                } catch (e) {
                    logError(e);
                    showSettingsErrorDialog(
                        "Файл налаштувань пошкоджений або має неправильний формат.",
                    );
                }
            });
        });

        resetButton.connect("clicked", () => {
            const confirmDialog = new Adw.MessageDialog({
                transient_for: window,
                heading: "Скинути налаштування?",
                body: "Усі налаштування розширення буде повернуто до значень за замовчуванням. Цю дію неможливо скасувати.",
            });
            confirmDialog.add_response("cancel", "Скасувати");
            confirmDialog.add_response("reset", "Скинути");
            confirmDialog.set_response_appearance(
                "reset",
                Adw.ResponseAppearance.DESTRUCTIVE,
            );
            confirmDialog.set_default_response("cancel");
            confirmDialog.set_close_response("cancel");

            confirmDialog.connect("response", (_dlg, response) => {
                if (response === "reset") {
                    const keys = settings.settings_schema.list_keys();
                    keys.forEach((key) => settings.reset(key));
                }
            });

            confirmDialog.present();
        });

        const previewPage = new Adw.PreferencesPage({
            title: "Прев'ю",
            icon_name: "zoom-in-symbolic",
        });
        window.add(previewPage);

        const animGroup = new Adw.PreferencesGroup({
            title: "Анімація",
        });
        previewPage.add(animGroup);

        const ANIMATIONS = [
            { name: "Back", def: 350 },
            { name: "Bounce", def: 500 },
            { name: "Circ", def: 300 },
            { name: "Cubic", def: 300 },
            { name: "Elastic", def: 800 },
            { name: "Expo", def: 400 },
            { name: "Linear", def: 300 },
            { name: "Quad", def: 250 },
            { name: "Quart", def: 300 },
            { name: "Quint", def: 350 },
            { name: "Sine", def: 200 },
        ];
        const animNames = ANIMATIONS.map((a) => a.name);

        const currentAnim = settings.get_string("preview-animation");
        let activeIdx = animNames.indexOf(currentAnim);
        if (activeIdx < 0) activeIdx = animNames.indexOf("Quad");

        const animRow = new Adw.ActionRow({
            title: "Тип анімації",
        });
        const animDropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(animNames),
            selected: activeIdx,
            valign: Gtk.Align.CENTER,
        });
        animRow.add_suffix(animDropdown);
        animGroup.add(animRow);

        const showRow = new Adw.ActionRow({
            title: "Тривалість появи (ms)",
        });
        const showButton = createScrollButton(
            0,
            { lower: 0, upper: 3000, step_increment: 50 },
            (val) => {
                if (isUpdatingAnim) return;
                const animName = animNames[animDropdown.selected];
                let customData = {};
                try {
                    customData = JSON.parse(
                        settings.get_string("preview-animation-custom") || "{}",
                    );
                } catch (e) {}
                customData[animName] = customData[animName] || {
                    show: 0,
                    hide: 0,
                };
                customData[animName].show = val;
                settings.set_string(
                    "preview-animation-custom",
                    JSON.stringify(customData),
                );
            },
        );
        showRow.add_suffix(showButton);
        animGroup.add(showRow);

        const hideRow = new Adw.ActionRow({
            title: "Тривалість приховування (ms)",
        });
        const hideButton = createScrollButton(
            0,
            { lower: 0, upper: 3000, step_increment: 50 },
            (val) => {
                if (isUpdatingAnim) return;
                const animName = animNames[animDropdown.selected];
                let customData = {};
                try {
                    customData = JSON.parse(
                        settings.get_string("preview-animation-custom") || "{}",
                    );
                } catch (e) {}
                customData[animName] = customData[animName] || {
                    show: 0,
                    hide: 0,
                };
                customData[animName].hide = val;
                settings.set_string(
                    "preview-animation-custom",
                    JSON.stringify(customData),
                );
            },
        );
        hideRow.add_suffix(hideButton);
        animGroup.add(hideRow);

        let isUpdatingAnim = false;

        const updateSpins = (animName) => {
            isUpdatingAnim = true;
            const base =
                ANIMATIONS.find((a) => a.name === animName) ||
                ANIMATIONS.find((a) => a.name === "Quad");
            let customData = {};
            try {
                customData = JSON.parse(
                    settings.get_string("preview-animation-custom") || "{}",
                );
            } catch (e) {}

            const data = customData[animName] || {
                show: base.def,
                hide: base.def,
            };
            showButton.label = String(data.show);
            hideButton.label = String(data.hide);
            isUpdatingAnim = false;
        };

        updateSpins(animNames[animDropdown.selected]);

        animDropdown.connect("notify::selected", () => {
            const selectedName = animNames[animDropdown.selected];
            settings.set_string("preview-animation", selectedName);
            updateSpins(selectedName);
        });

        const autocloseGroup = new Adw.PreferencesGroup({
            title: "Налаштування автоприховування",
        });
        previewPage.add(autocloseGroup);

        const autocloseRow = new Adw.SwitchRow({
            title: "Увімкнути автоприховування",
        });
        settings.bind(
            "preview-autoclose",
            autocloseRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT,
        );
        autocloseGroup.add(autocloseRow);

        const delayRow = new Adw.ActionRow({
            title: "Затримка перед приховуванням (sec)",
        });
        const delayButton = createNumericButton("preview-autoclose-delay", {
            lower: 1,
            upper: 60,
            step_increment: 1,
        });
        delayRow.add_suffix(delayButton);
        autocloseGroup.add(delayRow);

        const controlsPage = getControlsPage(settings);
        window.add(controlsPage);

        const filterPage = new Adw.PreferencesPage({
            title: "Фільтри",
            icon_name: "filter-symbolic",
        });
        window.add(filterPage);

        const filterGroup = new Adw.PreferencesGroup({
            title: "Керування плеєрами",
        });
        filterPage.add(filterGroup);

        const listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ["boxed-list"],
        });
        filterGroup.add(listBox);

        const cleanupGroup = new Adw.PreferencesGroup({
            title: "Очищення назв",
        });
        filterPage.add(cleanupGroup);

        const cleanupPresetNames = [
            "Вимкнено",
            "Легке",
            "Стандартне",
            "Агресивне",
            "Власне",
        ];
        const cleanupPresetKeys = [
            "off",
            "light",
            "standard",
            "aggressive",
            "custom",
        ];

        const cleanupPresetRow = new Adw.ActionRow({
            title: "Пресети",
        });

        let cleanupPresetIdx = cleanupPresetKeys.indexOf(
            settings.get_string("title-cleanup-preset"),
        );
        if (cleanupPresetIdx < 0) cleanupPresetIdx = 0;

        const cleanupPresetDropdown = new Gtk.DropDown({
            model: Gtk.StringList.new(cleanupPresetNames),
            selected: cleanupPresetIdx,
            valign: Gtk.Align.CENTER,
        });
        cleanupPresetRow.add_suffix(cleanupPresetDropdown);
        cleanupPresetRow.activatable_widget = cleanupPresetDropdown;
        cleanupGroup.add(cleanupPresetRow);

        const customWordsRow = new Adw.EntryRow({
            title: "Слова для видалення (через кому)",
        });

        const readCustomWords = () => {
            try {
                const parsed = JSON.parse(
                    settings.get_string("title-cleanup-custom-words") || "[]",
                );
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        };

        customWordsRow.set_text(readCustomWords().join(", "));

        const saveCustomWords = () => {
            const words = customWordsRow
                .get_text()
                .split(",")
                .map((w) => w.trim())
                .filter(Boolean);
            settings.set_string(
                "title-cleanup-custom-words",
                JSON.stringify(words),
            );
        };

        customWordsRow.connect("apply", saveCustomWords);

        const customWordsFocusCtrl = new Gtk.EventControllerFocus();
        customWordsFocusCtrl.connect("leave", saveCustomWords);
        customWordsRow.add_controller(customWordsFocusCtrl);

        let customWordsRowVisible = false;

        const syncCustomWordsRow = () => {
            const preset = cleanupPresetKeys[cleanupPresetDropdown.selected];
            const shouldShow = preset === "custom";

            if (shouldShow && !customWordsRowVisible) {
                cleanupGroup.add(customWordsRow);
                customWordsRowVisible = true;
            } else if (!shouldShow && customWordsRowVisible) {
                cleanupGroup.remove(customWordsRow);
                customWordsRowVisible = false;
            }
        };

        syncCustomWordsRow();

        cleanupPresetDropdown.connect("notify::selected", () => {
            const preset = cleanupPresetKeys[cleanupPresetDropdown.selected];
            if (settings.get_string("title-cleanup-preset") !== preset) {
                settings.set_string("title-cleanup-preset", preset);
            }
            syncCustomWordsRow();
        });

        settings.connect("changed::title-cleanup-preset", () => {
            const value = settings.get_string("title-cleanup-preset");
            const idx = cleanupPresetKeys.indexOf(value);
            if (idx >= 0 && idx !== cleanupPresetDropdown.selected) {
                cleanupPresetDropdown.selected = idx;
            }
            syncCustomWordsRow();
        });

        settings.connect("changed::title-cleanup-custom-words", () => {
            const text = readCustomWords().join(", ");
            if (customWordsRow.get_text() !== text) {
                customWordsRow.set_text(text);
            }
        });

        const buildFilterList = () => {
            let child = listBox.get_first_child();
            while (child) {
                listBox.remove(child);
                child = listBox.get_first_child();
            }

            let players;
            try {
                players = JSON.parse(settings.get_string("media-players"));
            } catch (e) {
                players = {};
            }

            const keys = Object.keys(players);

            if (keys.length === 0) {
                const emptyRow = new Adw.ActionRow({
                    title: "Плеєрів поки не виявлено",
                });
                listBox.append(emptyRow);
                return;
            }

            keys.forEach((id) => {
                const playerData = players[id];
                const row = new Adw.ActionRow({
                    title: playerData.name || "Unknown Player",
                });

                const visibilityBtn = new Gtk.Button({
                    icon_name: playerData.visible
                        ? "visible-symbolic"
                        : "layer-not-visible-symbolic",
                    valign: Gtk.Align.CENTER,
                });

                visibilityBtn.connect("clicked", () => {
                    const current = JSON.parse(
                        settings.get_string("media-players"),
                    );
                    if (current[id]) {
                        current[id].visible = !current[id].visible;
                        settings.set_string(
                            "media-players",
                            JSON.stringify(current),
                        );
                    }
                });

                const deleteBtn = new Gtk.Button({
                    icon_name: "trash-symbolic",
                    valign: Gtk.Align.CENTER,
                    css_classes: ["destructive-action"],
                });

                deleteBtn.connect("clicked", () => {
                    const current = JSON.parse(
                        settings.get_string("media-players"),
                    );
                    delete current[id];
                    settings.set_string(
                        "media-players",
                        JSON.stringify(current),
                    );
                });

                row.add_suffix(visibilityBtn);
                row.add_suffix(deleteBtn);
                listBox.append(row);
            });
        };

        buildFilterList();

        const signalId = settings.connect("changed::media-players", () => {
            buildFilterList();
        });

        window.connect("close-request", () => {
            settings.disconnect(signalId);
        });
    }
}
