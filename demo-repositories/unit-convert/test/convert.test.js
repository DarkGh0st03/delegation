import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLength, convertTemperature, LENGTH_UNITS } from "../src/convert.js";

test("lengths convert through meters", () => {
  assert.equal(convertLength(1, "km", "m"), 1000);
  assert.equal(convertLength(12, "in", "ft").toFixed(6), "1.000000");
  assert.deepEqual(LENGTH_UNITS, ["mm", "cm", "m", "km", "in", "ft", "mi"]);
  assert.throws(() => convertLength(1, "yd", "m"), /unknown length unit: yd/);
});

test("temperatures convert between C, F and K", () => {
  assert.equal(convertTemperature(100, "C", "F"), 212);
  assert.equal(convertTemperature(0, "C", "K"), 273.15);
  assert.equal(convertTemperature(32, "F", "C"), 0);
  assert.throws(() => convertTemperature(Number.NaN, "C", "F"), TypeError);
});
