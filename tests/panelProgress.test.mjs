import test from "node:test";
import assert from "node:assert/strict";
import {
    calculatePanelProgressGeometry,
    calculatePanelProgressFillWidth,
    paintPanelProgress,
} from "../src/panelProgress.js";

test("geometry includes half-cover underlap when artwork is visible", () => {
    assert.deepEqual(
        calculatePanelProgressGeometry({
            width: 120,
            height: 40,
            layoutX: 0,
            artVisible: true,
            artWidth: 40,
            artX: 0,
        }),
        { height: 40, trackX: 40, trackWidth: 80, underlapWidth: 20 },
    );
});

test("geometry starts at the left edge when artwork is hidden", () => {
    assert.deepEqual(
        calculatePanelProgressGeometry({
            width: 120,
            height: 40,
            layoutX: 0,
            artVisible: false,
            artWidth: 40,
            artX: 0,
        }),
        { height: 40, trackX: 0, trackWidth: 120, underlapWidth: 0 },
    );
});

test("geometry clamps the cover to the button and rounds dimensions", () => {
    assert.deepEqual(
        calculatePanelProgressGeometry({
            width: 50.4,
            height: 39.6,
            layoutX: 0.4,
            artVisible: true,
            artWidth: 80.2,
            artX: 0.4,
        }),
        { height: 40, trackX: 50, trackWidth: 0, underlapWidth: 25 },
    );
});

test("geometry is null when button dimensions are not positive", () => {
    assert.equal(
        calculatePanelProgressGeometry({
            width: 0,
            height: 40,
            layoutX: 0,
            artVisible: false,
            artWidth: 0,
            artX: 0,
        }),
        null,
    );
});

test("fill width represents zero, half, and full progress", () => {
    assert.equal(calculatePanelProgressFillWidth(0, 100, 80, 20), 20);
    assert.equal(calculatePanelProgressFillWidth(50, 100, 80, 20), 60);
    assert.equal(calculatePanelProgressFillWidth(100, 100, 80, 20), 100);
});

test("fill width clamps negative positions, excess positions, and missing duration", () => {
    assert.equal(calculatePanelProgressFillWidth(-10, 100, 80, 20), 20);
    assert.equal(calculatePanelProgressFillWidth(150, 100, 80, 20), 100);
    assert.equal(calculatePanelProgressFillWidth(50, 0, 80, 20), 20);
});

test("renderer clears, paints the fill, and always disposes Cairo context", () => {
    const calls = { operators: [], fills: 0, arcs: 0, disposed: false };
    const cr = {
        setOperator(value) { calls.operators.push(value); },
        paint() {},
        newSubPath() {},
        rectangle() {},
        arc() { calls.arcs += 1; },
        closePath() {},
        setSourceRGBA() {},
        fill() { calls.fills += 1; },
        $dispose() { calls.disposed = true; },
    };

    paintPanelProgress(
        { height: 40, get_context: () => cr },
        {
            Cairo: { Operator: { CLEAR: 0, OVER: 2 } },
            geometry: { trackX: 40, trackWidth: 80, underlapWidth: 20 },
            position: 50,
            duration: 100,
            radius: 8,
        },
    );

    assert.deepEqual(calls.operators, [0, 2]);
    assert.equal(calls.fills, 1);
    assert.equal(calls.arcs, 4);
    assert.equal(calls.disposed, true);
});

test("renderer disposes Cairo context when geometry is unavailable", () => {
    let disposed = false;
    const cr = {
        setOperator() {},
        paint() {},
        $dispose() { disposed = true; },
    };

    paintPanelProgress(
        { height: 40, get_context: () => cr },
        { Cairo: { Operator: { CLEAR: 0, OVER: 2 } }, geometry: null },
    );

    assert.equal(disposed, true);
});
