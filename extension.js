import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { MediaPlayerIndicator } from "./src/mediaPlayerIndicator.js";

export default class FlatMediaPlayerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = null;

        this._positionChangedId = this._settings.connect(
            "changed::panel-position",
            () => {
                this._rebuildIndicator();
            },
        );

        this._indexChangedId = this._settings.connect(
            "changed::panel-index",
            () => {
                this._rebuildIndicator();
            },
        );

        this._rebuildIndicator();
    }

    _rebuildIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        const positionIndex = this._settings.get_int("panel-position");
        const panelIndex = this._settings.get_int("panel-index");
        const positions = ["left", "center", "right"];
        const targetBox = positions[positionIndex] || "center";

        this._indicator = new MediaPlayerIndicator(this);

        Main.panel.addToStatusArea(
            this.uuid,
            this._indicator,
            panelIndex,
            targetBox,
        );
    }

    disable() {
        if (this._positionChangedId)
            this._settings.disconnect(this._positionChangedId);
        if (this._indexChangedId)
            this._settings.disconnect(this._indexChangedId);

        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
