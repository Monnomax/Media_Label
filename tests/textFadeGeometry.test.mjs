import assert from "node:assert/strict";
import test from "node:test";
import { getTextFadeState } from "../src/textFadeGeometry.js";

test("does not fade a title that fits in the container", () => {
    assert.deepEqual(getTextFadeState(0, 180, 200), {
        left: false,
        right: false,
    });
});

test("at the start, only the right edge fades", () => {
    assert.deepEqual(getTextFadeState(0, 300, 200), {
        left: false,
        right: true,
    });
});

test("in the middle, both edges fade", () => {
    assert.deepEqual(getTextFadeState(-50, 300, 200), {
        left: true,
        right: true,
    });
});

test("at the end, only the left edge fades", () => {
    assert.deepEqual(getTextFadeState(-100, 300, 200), {
        left: true,
        right: false,
    });
});

test("ignores negligible overflow", () => {
    assert.deepEqual(getTextFadeState(0, 200.25, 200), {
        left: false,
        right: false,
    });
});

test("does not enable the left fade while returning to the start", () => {
    assert.deepEqual(getTextFadeState(-0.25, 300, 200), {
        left: false,
        right: true,
    });
});
