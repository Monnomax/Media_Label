import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "src/mediaPlayerIndicator.js"), "utf8");
const destroyStart = source.indexOf("        destroy() {");
const parentDestroy = source.indexOf("            super.destroy();", destroyStart);
assert.ok(destroyStart >= 0, "MediaPlayerIndicator.destroy() must exist");
assert.ok(parentDestroy > destroyStart, "destroy() must call super.destroy()");
const destroyBody = source.slice(destroyStart, parentDestroy + "            super.destroy();".length);

test("destroy marks the indicator destroyed before releasing resources", () => {
    assert.ok(destroyBody.indexOf("this._isDestroyed = true;") >= 0);
    assert.ok(
        destroyBody.indexOf("this._isDestroyed = true;") < destroyBody.indexOf("super.destroy();"),
    );
});

test("destroy removes long-press and seek-hide timers", () => {
    assert.match(destroyBody, /GLib\.source_remove\(this\._longPressTimeoutId\)/);
    assert.match(destroyBody, /this\._longPressTimeoutId = null/);
    assert.match(destroyBody, /GLib\.source_remove\(this\._seekHideTimeoutId\)/);
    assert.match(destroyBody, /this\._seekHideTimeoutId = null/);
});

test("destroy stops panel and detailed progress polling", () => {
    assert.match(destroyBody, /_progressController\.stopDetailedProgressPolling\(\)/);
    assert.match(destroyBody, /this\._stopPanelProgressPolling\(\)/);
});

test("destroy disconnects settings and size-change signals", () => {
    assert.match(destroyBody, /this\._settings\.disconnect\(this\._settingsId\)/);
    assert.match(destroyBody, /this\._settings\.disconnect\(this\._playersSettingsId\)/);
    assert.match(destroyBody, /this\.disconnect\(this\._heightNotifyId\)/);
    assert.match(destroyBody, /this\.disconnect\(this\._widthNotifyId\)/);
    assert.match(destroyBody, /this\.albumArt\.disconnect\(this\._albumArtWidthNotifyId\)/);
});

test("destroy disconnects theme change signal", () => {
    assert.match(destroyBody, /this\._themeContext\.disconnect\(this\._themeChangedId\)/);
});

test("destroy tears down MPRIS manager and clears player references", () => {
    assert.match(destroyBody, /this\._playerManager\.destroy\(\)/);
    assert.match(destroyBody, /this\._playerProxy = null/);
    assert.match(destroyBody, /this\._currentPlayerAddress = null/);
    assert.ok(destroyBody.indexOf("this._playerManager.destroy()") < destroyBody.indexOf("super.destroy();"));
});

test("Cairo stays imported and available to the panel progress painter", () => {
    assert.match(source, /^import Cairo from "gi:\/\/cairo";/m);
    const painterCalls = [...source.matchAll(/paintPanelProgress\s*\([^;]*?\)/gs)];
    assert.ok(painterCalls.length > 0, "panel progress painter call must exist");
    assert.ok(
        painterCalls.some((match) => /\bCairo\b/.test(match[0])),
        "Cairo must be passed to or referenced by the panel progress painter call",
    );
});
