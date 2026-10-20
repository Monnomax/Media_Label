import test from "node:test";
import assert from "node:assert/strict";
import {
    buildTrackKey,
    getArtworkUrl,
    getTrackLength,
} from "../src/metadataUtils.js";

test("buildTrackKey keeps a stable default for missing metadata", () => {
    assert.equal(
        buildTrackKey({}),
        JSON.stringify({ id: "", title: "", artists: [""], album: "" }),
    );
});

test("buildTrackKey preserves track fields and stringifies an artist array", () => {
    assert.equal(
        buildTrackKey({
            "mpris:trackid": 42,
            "xesam:title": "Example",
            "xesam:artist": ["Artist A", 7],
            "xesam:album": "Album",
        }),
        JSON.stringify({
            id: "42",
            title: "Example",
            artists: ["Artist A", "7"],
            album: "Album",
        }),
    );
});

test("buildTrackKey normalizes a single artist to a one-element array", () => {
    const key = JSON.parse(buildTrackKey({ "xesam:artist": "Solo Artist" }));
    assert.deepEqual(key.artists, ["Solo Artist"]);
});

test("buildTrackKey uses empty strings for nullish values", () => {
    const key = JSON.parse(buildTrackKey({
        "mpris:trackid": null,
        "xesam:title": null,
        "xesam:artist": null,
        "xesam:album": null,
    }));
    assert.deepEqual(key, { id: "", title: "", artists: [""], album: "" });
});

test("getTrackLength accepts numeric and numeric-string durations", () => {
    assert.equal(getTrackLength({ "mpris:length": 120000000 }), 120000000);
    assert.equal(getTrackLength({ "mpris:length": "4500000" }), 4500000);
});

test("getTrackLength returns zero for missing, invalid, or zero duration", () => {
    assert.equal(getTrackLength({}), 0);
    assert.equal(getTrackLength({ "mpris:length": "unknown" }), 0);
    assert.equal(getTrackLength({ "mpris:length": 0 }), 0);
});

test("getArtworkUrl returns the existing URL or an empty fallback", () => {
    assert.equal(
        getArtworkUrl({ "mpris:artUrl": "file:///tmp/art.png" }),
        "file:///tmp/art.png",
    );
    assert.equal(getArtworkUrl({}), "");
    assert.equal(getArtworkUrl({ "mpris:artUrl": null }), "");
});
