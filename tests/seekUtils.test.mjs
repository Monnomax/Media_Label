import test from "node:test";
import assert from "node:assert/strict";
import { calculateSeekPosition } from "../src/seekUtils.js";

test("seek position adds a positive offset", () => {
    assert.equal(calculateSeekPosition(10_000_000, 5_000_000, 60_000_000), 15_000_000);
});

test("seek position subtracts a negative offset", () => {
    assert.equal(calculateSeekPosition(10_000_000, -5_000_000, 60_000_000), 5_000_000);
});

test("seek position never falls below zero", () => {
    assert.equal(calculateSeekPosition(2_000_000, -5_000_000, 60_000_000), 0);
});

test("seek position never exceeds a known duration", () => {
    assert.equal(calculateSeekPosition(58_000_000, 5_000_000, 60_000_000), 60_000_000);
});

test("unknown or zero duration keeps forward seeking available", () => {
    assert.equal(calculateSeekPosition(10_000_000, 5_000_000, 0), 15_000_000);
    assert.equal(calculateSeekPosition(10_000_000, 5_000_000, null), 15_000_000);
});

test("missing local position starts from zero", () => {
    assert.equal(calculateSeekPosition(undefined, 5_000_000, 60_000_000), 5_000_000);
});
