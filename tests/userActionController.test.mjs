import test from "node:test";
import assert from "node:assert/strict";
import {
    handlePanelButtonPress,
    handlePanelButtonRelease,
    handlePanelScroll,
    mprisCall,
    mprisSeek,
} from "../src/userActionController.js";

const Clutter = {
    EVENT_STOP: "event-stop",
    BUTTON_PRIMARY: 1,
    BUTTON_MIDDLE: 2,
    BUTTON_SECONDARY: 3,
    ScrollDirection: { UP: "up", DOWN: "down", SMOOTH: "smooth" },
};

function makeGLib() {
    const calls = [];
    return {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        calls,
        source_remove(id) { calls.push(["source_remove", id]); },
        timeout_add(priority, milliseconds, callback) {
            calls.push(["timeout_add", priority, milliseconds, callback]);
            return 73;
        },
    };
}

function makeIndicator(overrides = {}) {
    const calls = [];
    const indicator = {
        _isDestroyed: false,
        _visualState: "normal",
        _longPressTimeoutId: null,
        _playerProxy: { PlaybackStatus: "Playing" },
        _currentPlayerAddress: "org.mpris.MediaPlayer2.test",
        _settings: { get_int: (key) => key === "seek-step" ? 4_000_000 : 0 },
        _playerManager: {
            call(...args) { calls.push(["call", ...args]); },
            seek(...args) { calls.push(["seek", ...args]); },
        },
        menu: { isOpen: false, toggle() { calls.push(["toggle-menu"]); } },
        _syncThemeButtonPseudoClasses() { calls.push(["sync-pseudo"]); },
        _updateBackground() { calls.push(["update-background"]); },
        _handleSeekScroll(offset) { calls.push(["seek-scroll", offset]); },
        _mprisCall(method) { return mprisCall.call(this, method); },
        calls,
    };
    return Object.assign(indicator, overrides);
}

function eventWithButton(button) {
    return { get_button: () => button };
}

function eventWithDirection(direction) {
    return { get_scroll_direction: () => direction };
}

test("button press stops after destruction without changing state", () => {
    const glib = makeGLib();
    const indicator = makeIndicator({ _isDestroyed: true });
    assert.equal(handlePanelButtonPress.call(indicator, eventWithButton(Clutter.BUTTON_PRIMARY), Clutter, glib), Clutter.EVENT_STOP);
    assert.equal(indicator._visualState, "normal");
    assert.equal(glib.calls.length, 0);
});

test("primary press sets pressed state and schedules the long-press menu", () => {
    const glib = makeGLib();
    const indicator = makeIndicator();
    const result = handlePanelButtonPress.call(indicator, eventWithButton(Clutter.BUTTON_PRIMARY), Clutter, glib);
    assert.equal(result, Clutter.EVENT_STOP);
    assert.equal(indicator._visualState, "pressed");
    assert.equal(indicator._longPressTimeoutId, 73);
    const timer = glib.calls.find((call) => call[0] === "timeout_add");
    assert.equal(timer[2], 500);
    assert.equal(timer[3](), glib.SOURCE_REMOVE);
    assert.equal(indicator._longPressTimeoutId, null);
    assert.ok(indicator.calls.some((call) => call[0] === "toggle-menu"));
});

test("primary release cancels a pending long press and calls Previous", () => {
    const glib = makeGLib();
    const indicator = makeIndicator({ _longPressTimeoutId: 55 });
    handlePanelButtonRelease.call(indicator, eventWithButton(Clutter.BUTTON_PRIMARY), Clutter, glib);
    assert.ok(glib.calls.some((call) => call[0] === "source_remove" && call[1] === 55));
    assert.equal(indicator._longPressTimeoutId, null);
    assert.ok(indicator.calls.some((call) => call[0] === "call" && call[2] === "Previous"));
});

test("secondary and middle release call Next and PlayPause", () => {
    for (const [button, method] of [[Clutter.BUTTON_SECONDARY, "Next"], [Clutter.BUTTON_MIDDLE, "PlayPause"]]) {
        const indicator = makeIndicator();
        handlePanelButtonRelease.call(indicator, eventWithButton(button), Clutter, makeGLib());
        assert.ok(indicator.calls.some((call) => call[0] === "call" && call[2] === method));
    }
});

test("panel scroll applies configured positive and negative seek steps", () => {
    const indicator = makeIndicator();
    assert.equal(handlePanelScroll.call(indicator, eventWithDirection(Clutter.ScrollDirection.UP), Clutter), Clutter.EVENT_STOP);
    assert.equal(handlePanelScroll.call(indicator, eventWithDirection(Clutter.ScrollDirection.DOWN), Clutter), Clutter.EVENT_STOP);
    assert.deepEqual(indicator.calls.filter((call) => call[0] === "seek-scroll"), [["seek-scroll", 4_000_000], ["seek-scroll", -4_000_000]]);
});

test("panel scroll ignores smooth/unknown directions and destroyed indicators", () => {
    const indicator = makeIndicator();
    handlePanelScroll.call(indicator, eventWithDirection(Clutter.ScrollDirection.SMOOTH), Clutter);
    assert.equal(indicator.calls.filter((call) => call[0] === "seek-scroll").length, 0);
    const destroyed = makeIndicator({ _isDestroyed: true });
    assert.equal(handlePanelScroll.call(destroyed, eventWithDirection(Clutter.ScrollDirection.UP), Clutter), Clutter.EVENT_STOP);
    assert.equal(destroyed.calls.length, 0);
});

test("mprisCall forwards only when a proxy and address are available", () => {
    const indicator = makeIndicator();
    mprisCall.call(indicator, "Next");
    assert.deepEqual(indicator.calls.filter((call) => call[0] === "call"), [["call", "org.mpris.MediaPlayer2.test", "Next"]]);
    const inactive = makeIndicator({ _playerProxy: null });
    mprisCall.call(inactive, "Next");
    assert.equal(inactive.calls.length, 0);
});

test("mprisSeek forwards the offset only when a proxy and address exist", () => {
    const indicator = makeIndicator();
    mprisSeek.call(indicator, -2_500_000);
    assert.deepEqual(indicator.calls.filter((call) => call[0] === "seek"), [["seek", "org.mpris.MediaPlayer2.test", -2_500_000]]);
    const inactive = makeIndicator({ _currentPlayerAddress: null });
    mprisSeek.call(inactive, 2_500_000);
    assert.equal(inactive.calls.length, 0);
});
