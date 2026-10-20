import test from "node:test";
import assert from "node:assert/strict";
import { setActivePlayer, clearActivePlayer, updateVisibility } from "../src/activePlayerController.js";

function makeIndicator(overrides = {}) {
    const calls = [];
    const indicator = {
        _isDestroyed: false,
        _currentPlayerAddress: "org.mpris.MediaPlayer2.old",
        _playerProxy: { PlaybackStatus: "Paused" },
        _currentArtUrl: "old-art",
        _currentTrackKey: "old-track",
        _panelProgressPosition: 42,
        _seekLength: 100,
        _settings: {
            get_int: (key) => key === "album-radius" ? 12 : 0,
            get_string: () => JSON.stringify({}),
        },
        _playerManager: { getAppIdentifier: () => "test-player" },
        _resetSeekState() { calls.push("resetSeekState"); },
        _updateMetadata() { calls.push("updateMetadata"); },
        _updateVisibility() { calls.push("updateVisibility"); return updateVisibility.call(this); },
        _startPanelProgressPolling() { calls.push("startPolling"); },
        _stopPanelProgressPolling() { calls.push("stopPolling"); },
        _pollPanelProgress() { calls.push("pollProgress"); },
        _updatePanelProgressFill(...args) { calls.push(["fill", ...args]); },
        albumArt: { updateArt(...args) { calls.push(["art", ...args]); } },
        visible: true,
        calls,
    };
    return Object.assign(indicator, overrides);
}

test("setActivePlayer ignores calls after destroy", () => {
    const indicator = makeIndicator({ _isDestroyed: true });
    setActivePlayer.call(indicator, "org.mpris.MediaPlayer2.next", { PlaybackStatus: "Playing" });
    assert.equal(indicator._currentPlayerAddress, "org.mpris.MediaPlayer2.old");
    assert.deepEqual(indicator.calls, []);
});

test("setActivePlayer resets track and starts polling for a new playing player", () => {
    const proxy = { PlaybackStatus: "Playing" };
    const indicator = makeIndicator();
    setActivePlayer.call(indicator, "org.mpris.MediaPlayer2.next", proxy);
    assert.equal(indicator._currentPlayerAddress, "org.mpris.MediaPlayer2.next");
    assert.equal(indicator._playerProxy, proxy);
    assert.equal(indicator._panelProgressPosition, 0);
    assert.equal(indicator._currentTrackKey, null);
    assert.deepEqual(indicator.calls, ["resetSeekState", "updateMetadata", "updateVisibility", "startPolling"]);
});

test("setActivePlayer preserves seek state for the same paused player", () => {
    const proxy = { PlaybackStatus: "Paused" };
    const indicator = makeIndicator();
    setActivePlayer.call(indicator, "org.mpris.MediaPlayer2.old", proxy);
    assert.equal(indicator._panelProgressPosition, 42);
    assert.equal(indicator._currentTrackKey, "old-track");
    assert.deepEqual(indicator.calls, ["updateMetadata", "updateVisibility", "stopPolling", "pollProgress"]);
});

test("clearActivePlayer clears active state and artwork", () => {
    const indicator = makeIndicator();
    clearActivePlayer.call(indicator);
    assert.equal(indicator._currentPlayerAddress, null);
    assert.equal(indicator._playerProxy, null);
    assert.equal(indicator._currentArtUrl, null);
    assert.equal(indicator._currentTrackKey, null);
    assert.equal(indicator._panelProgressPosition, 0);
    assert.equal(indicator._seekLength, 0);
    assert.equal(indicator.visible, false);
    assert.ok(indicator.calls.includes("stopPolling"));
    assert.ok(indicator.calls.some((entry) => Array.isArray(entry) && entry[0] === "fill" && entry[1] === 0 && entry[2] === 0));
    assert.ok(indicator.calls.some((entry) => Array.isArray(entry) && entry[0] === "art" && entry[1] === null && entry[2] === 12));
});

test("updateVisibility hides when there is no active player", () => {
    const indicator = makeIndicator({ _currentPlayerAddress: null, _playerProxy: null, visible: true });
    updateVisibility.call(indicator);
    assert.equal(indicator.visible, false);
});

test("updateVisibility shows an allowed playing player by default", () => {
    const indicator = makeIndicator({ _playerProxy: { PlaybackStatus: "Playing" } });
    updateVisibility.call(indicator);
    assert.equal(indicator.visible, true);
});

test("updateVisibility respects a player's hidden setting", () => {
    const indicator = makeIndicator({
        _playerProxy: { PlaybackStatus: "Playing" },
        _settings: {
            get_int: (key) => key === "album-radius" ? 12 : 0,
            get_string: () => JSON.stringify({ "test-player": { visible: false } }),
        },
    });
    updateVisibility.call(indicator);
    assert.equal(indicator.visible, false);
});
