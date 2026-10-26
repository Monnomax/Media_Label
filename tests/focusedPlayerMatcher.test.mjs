import assert from "node:assert/strict";
import test from "node:test";

import { matchesFocusedApplication } from "../src/focusedPlayerMatcher.js";

test("matches a focused application with a simple MPRIS service name", () => {
    assert.equal(
        matchesFocusedApplication(
            "spotify.desktop",
            "org.mpris.MediaPlayer2.spotify",
        ),
        true,
    );
});

test("matches a desktop ID with vendor and client components", () => {
    assert.equal(
        matchesFocusedApplication(
            "com.spotify.Client.desktop",
            "org.mpris.MediaPlayer2.spotify",
        ),
        true,
    );
});

test("matches an application using its MPRIS Identity", () => {
    assert.equal(
        matchesFocusedApplication(
            "org.videolan.VLC.desktop",
            "org.mpris.MediaPlayer2.vlc",
            "VLC media player",
        ),
        true,
    );
});

test("matches MPRIS instance names without the instance suffix", () => {
    assert.equal(
        matchesFocusedApplication(
            "org.mozilla.firefox.desktop",
            "org.mpris.MediaPlayer2.firefox.instance1234",
        ),
        true,
    );
});

test("does not match an unrelated focused window", () => {
    assert.equal(
        matchesFocusedApplication(
            "org.gnome.TextEditor.desktop",
            "org.mpris.MediaPlayer2.spotify",
            "Spotify",
        ),
        false,
    );
});
