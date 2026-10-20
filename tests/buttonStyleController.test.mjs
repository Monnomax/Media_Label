import test from "node:test";
import assert from "node:assert/strict";
import {
    applyCustomStyles,
    updateBackground,
    syncThemeButtonPseudoClasses,
} from "../src/buttonStyleController.js";

const DisplayMode = { ART: 0, BOTH: 1, TEXT: 2 };

function makeContext(overrides = {}) {
    const calls = [];
    const context = {
        _isDestroyed: false,
        _settings: {
            get_boolean: (key) => key === "auto-color" ? false : false,
            get_int: (key) => ({
                "color-intensity": 70,
                "album-radius": 8,
                "padding-left": 5,
                "padding-right": 6,
                "button-width": 240,
                "display-mode": DisplayMode.TEXT,
            })[key] ?? 0,
        },
        albumArt: {
            _avgColor: null,
            visible: true,
            width: 0,
            _radius: 0,
            queue_repaint() { calls.push(["art-queue-repaint"]); },
        },
        trackLabel: {
            applyTextColor(color) { calls.push(["text-color", color]); },
            applyWidth(width) { calls.push(["text-width", width]); },
            restoreNaturalWidth() { calls.push(["restore-width"]); },
            set_width(width) { calls.push(["set-width", width]); },
            remove_all_transitions() { calls.push(["remove-label-transitions"]); },
            ease(options) { calls.push(["label-ease", options]); },
            remove_transition(name) { calls.push(["remove-label-transition", name]); },
            growToFit(width) { calls.push(["grow-to-fit", width]); },
            opacity: 255,
        },
        _trackStack: { visible: true },
        layout: { x: 0, set_style(style) { calls.push(["layout-style", style]); } },
        width: 300,
        height: 40,
        _currentRadius: 8,
        _currentIntensity: 0.7,
        _useThemeButtonAppearance: false,
        _useThemeColors: true,
        _visualState: "normal",
        _palette: null,
        _paletteManager: {
            getThemeButtonColors() {
                return {
                    normal: { r: 1, g: 2, b: 3, a: 1 },
                    hover: { r: 4, g: 5, b: 6, a: 1 },
                    pressed: { r: 7, g: 8, b: 9, a: 1 },
                };
            },
            generatePalette(color, intensity) {
                calls.push(["generate-palette", color, intensity]);
                return {
                    background: { r: 10, g: 11, b: 12 },
                    hover: { r: 13, g: 14, b: 15 },
                    pressed: { r: 16, g: 17, b: 18 },
                    text: { r: 19, g: 20, b: 21 },
                };
            },
        },
        add_style_class_name(name) { calls.push(["add-class", name]); },
        remove_style_class_name(name) { calls.push(["remove-class", name]); },
        remove_style_pseudo_class(name) { calls.push(["remove-pseudo", name]); },
        add_style_pseudo_class(name) { calls.push(["add-pseudo", name]); },
        set_style(style) { calls.push(["set-style", style]); },
        _updateBackground() { calls.push(["update-background"]); },
        _syncThemeButtonPseudoClasses() { calls.push(["sync-pseudo"]); },
        _updatePanelProgressGeometry() { calls.push(["update-geometry"]); },
        calls,
    };
    return Object.assign(context, overrides);
}

test("syncThemeButtonPseudoClasses does nothing when theme appearance is disabled", () => {
    const ctx = makeContext({ _useThemeButtonAppearance: false });
    syncThemeButtonPseudoClasses.call(ctx);
    assert.equal(ctx.calls.length, 0);
});

test("syncThemeButtonPseudoClasses applies hover and active pseudo-classes", () => {
    const ctx = makeContext({ _useThemeButtonAppearance: true, _visualState: "pressed" });
    syncThemeButtonPseudoClasses.call(ctx);
    assert.deepEqual(ctx.calls.filter((x) => x[0] === "remove-pseudo"), [["remove-pseudo", "hover"], ["remove-pseudo", "active"]]);
    assert.deepEqual(ctx.calls.filter((x) => x[0] === "add-pseudo"), [["add-pseudo", "hover"], ["add-pseudo", "active"]]);
});

test("updateBackground preserves the shell theme appearance in text-only mode", () => {
    const ctx = makeContext({ _useThemeButtonAppearance: true });
    updateBackground.call(ctx);
    assert.equal(ctx.calls.length, 1);
    assert.match(ctx.calls[0][1], /-natural-hpadding: 0px/);
    assert.match(ctx.calls[0][1], /-minimum-hpadding: 0px/);
});

test("updateBackground chooses theme color for the current visual state", () => {
    const ctx = makeContext({ _useThemeButtonAppearance: false, _useThemeColors: true, _visualState: "hover" });
    updateBackground.call(ctx);
    const style = ctx.calls.find((x) => x[0] === "set-style")[1];
    assert.match(style, /background-color: rgba\(4, 5, 6, 1\)/);
});

test("updateBackground uses adaptive palette when theme colors are disabled", () => {
    const ctx = makeContext({
        _useThemeButtonAppearance: false,
        _useThemeColors: false,
        _visualState: "pressed",
        _palette: {
            background: { r: 1, g: 2, b: 3 },
            hover: { r: 4, g: 5, b: 6 },
            pressed: { r: 21, g: 22, b: 23 },
        },
    });
    updateBackground.call(ctx);
    const style = ctx.calls.find((x) => x[0] === "set-style")[1];
    assert.match(style, /background-color: rgba\(21, 22, 23, 0\.7\)/);
});

test("applyCustomStyles sets text-only visibility and applies user padding", () => {
    const ctx = makeContext();
    applyCustomStyles.call(ctx, DisplayMode);
    assert.equal(ctx.albumArt.visible, false);
    assert.equal(ctx._trackStack.visible, true);
    assert.equal(ctx._useThemeButtonAppearance, true);
    assert.equal(ctx._useThemeColors, true);
    assert.ok(ctx.calls.some((x) => x[0] === "text-width" && x[1] === 240));
    const layoutStyle = ctx.calls.find((x) => x[0] === "layout-style")[1];
    assert.match(layoutStyle, /padding-left: 5px/);
    assert.match(layoutStyle, /padding-right: 6px/);
    assert.ok(ctx.calls.some((x) => x[0] === "update-geometry"));
});

test("applyCustomStyles skips work after destruction", () => {
    const ctx = makeContext({ _isDestroyed: true });
    applyCustomStyles.call(ctx, DisplayMode);
    assert.equal(ctx.calls.length, 0);
});
