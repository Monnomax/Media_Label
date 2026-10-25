import assert from "node:assert/strict";
import test from "node:test";

import { paintPanelProgress } from "../src/panelProgress.js";

test("full progress ends at the allocated DrawingArea right edge", () => {
    const arcs = [];

    const context = {
        setOperator() {},
        paint() {},
        newSubPath() {},
        arc(x, y, radius, startAngle, endAngle) {
            arcs.push({ x, y, radius, startAngle, endAngle });
        },
        rectangle() {},
        closePath() {},
        setSourceRGBA() {},
        fill() {},
        $dispose() {},
    };

    const area = {
        width: 99,
        height: 40,
        get_context: () => context,
    };

    paintPanelProgress(area, {
        Cairo: { Operator: { CLEAR: 0, OVER: 1 } },
        geometry: {
            trackX: 20,
            trackWidth: 80,
            underlapWidth: 0,
        },
        position: 100,
        duration: 100,
        radius: 10,
    });

    assert.equal(arcs.length, 4);
    assert.equal(arcs[0].x + arcs[0].radius, area.width);
    assert.equal(arcs[1].x + arcs[1].radius, area.width);
});
