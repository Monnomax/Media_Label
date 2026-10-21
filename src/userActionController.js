export function handlePanelButtonPress(event, Clutter, GLib) {
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

export function handlePanelButtonRelease(event, Clutter, GLib) {
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

export function handlePanelScroll(event, Clutter) {
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

export function mprisCall(method) {
    if (!this._playerProxy || !this._currentPlayerAddress) return;
    this._playerManager.call(this._currentPlayerAddress, method);
}

export function mprisSeek(offsetUs) {
    if (!this._playerProxy || !this._currentPlayerAddress) return;
    this._playerManager.seek(this._currentPlayerAddress, offsetUs);
}
