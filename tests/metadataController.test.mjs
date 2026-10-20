import test from "node:test";
import assert from "node:assert/strict";
import { updateMetadata } from "../src/metadataController.js";
import { buildTrackKey } from "../src/metadataUtils.js";

function makeIndicator(metadata, overrides = {}) {
    const calls = {};
    const variant = metadata === undefined
        ? null
        : { recursiveUnpack: () => metadata };
    const indicator = {
        _playerProxy: {
            get_cached_property: () => variant,
        },
        _playerManager: { getAppIdentifier: () => "test-player" },
        _currentPlayerAddress: "org.mpris.MediaPlayer2.test",
        _currentTrackKey: null,
        _panelProgressPosition: 0,
        _seekLength: 0,
        _seekActive: false,
        _settings: { get_int: (key) => key === "album-radius" ? 12 : 0 },
        _detailedWindow: { updateInfo: (...args) => { calls.detail = args; } },
        trackLabel: {
            set_text: (value) => { calls.text = value; },
            updateFromMetadata: (value) => { calls.trackMetadata = value; },
        },
        _resetSeekState: () => { calls.resetSeekState = (calls.resetSeekState || 0) + 1; },
        _updatePanelProgressFill: (position, length) => { calls.progress = [position, length]; },
        seekOverlay: { updateProgress: (...args) => { calls.seekProgress = args; } },
        _syncSeekWidth: () => { calls.syncSeekWidth = true; },
        albumArt: { updateArt: (...args) => { calls.art = args; } },
        _applyCustomStyles: () => { calls.stylesApplied = true; },
        calls,
    };
    return Object.assign(indicator, overrides);
}

test("updateMetadata returns when there is no active player proxy", () => {
    const indicator = makeIndicator(undefined, { _playerProxy: null });
    updateMetadata.call(indicator);
    assert.equal(indicator.calls.text, undefined);
    assert.equal(indicator.calls.trackMetadata, undefined);
});

test("updateMetadata shows waiting text when metadata is missing", () => {
    const indicator = makeIndicator(undefined);
    updateMetadata.call(indicator);
    assert.equal(indicator.calls.text, "Очікування даних...");
    assert.equal(indicator.calls.trackMetadata, undefined);
});

test("updateMetadata updates track, duration, artwork, and detailed window", () => {
    const metadata = {
        "mpris:trackid": "/track/one",
        "xesam:title": "Example Track",
        "xesam:artist": ["Example Artist"],
        "xesam:album": "Example Album",
        "mpris:length": 180000000,
        "mpris:artUrl": "https://example.invalid/cover.jpg",
    };
    const indicator = makeIndicator(metadata);
    updateMetadata.call(indicator);
    assert.equal(indicator.calls.trackMetadata, metadata);
    assert.deepEqual(indicator.calls.detail, [metadata, "test-player"]);
    assert.equal(indicator._currentTrackKey, buildTrackKey(metadata));
    assert.equal(indicator._seekLength, 180000000);
    assert.deepEqual(indicator.calls.progress, [0, 180000000]);
    assert.deepEqual(indicator.calls.art, ["https://example.invalid/cover.jpg", 12]);
    assert.equal(indicator.calls.stylesApplied, true);
});

test("updateMetadata resets seek state when the track changes", () => {
    const metadata = {
        "mpris:trackid": "/track/two",
        "xesam:title": "New Track",
        "xesam:artist": "Artist",
        "mpris:length": 90000000,
    };
    const indicator = makeIndicator(metadata, {
        _currentTrackKey: "old-track-key",
        _panelProgressPosition: 45000000,
    });
    updateMetadata.call(indicator);
    assert.equal(indicator.calls.resetSeekState, 1);
    assert.equal(indicator._panelProgressPosition, 0);
    assert.deepEqual(indicator.calls.progress, [0, 90000000]);
});

test("updateMetadata refreshes seek overlay while seek mode is active", () => {
    const metadata = {
        "mpris:trackid": "/track/three",
        "xesam:title": "Seeking Track",
        "mpris:length": 120000000,
    };
    const indicator = makeIndicator(metadata, {
        _currentTrackKey: buildTrackKey(metadata),
        _seekActive: true,
        _seekPosition: 30000000,
    });
    updateMetadata.call(indicator);
    assert.deepEqual(indicator.calls.seekProgress, [30000000, 120000000]);
    assert.equal(indicator.calls.syncSeekWidth, true);
});
