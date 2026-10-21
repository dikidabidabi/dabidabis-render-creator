import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { DYNAMIC_WINDOW_INITIAL_CM, normalizeWindow, windowDividerFractions, windowLengthCm, windowPlanGeometry } from "./windows";

const dynamic = (lengthCm: number, tolerance = 20) => ({
  a: { x: 0, y: 0 }, b: { x: lengthCm / 100 * 80, y: 0 },
  kind: "dynamic" as const, leaves: 1, dividerSpacingCm: 100, endToleranceCm: tolerance,
});

describe("dynamic windows", () => {
  test("initial length is 50 cm", () => {
    assert.equal(DYNAMIC_WINDOW_INITIAL_CM, 50);
    assert.equal(normalizeWindow(dynamic(50))?.widthCm, 50);
  });
  test("dynamic drag length exceeds regular 600 cm maximum", () => {
    assert.equal(windowLengthCm(1800, "dynamic"), 1800);
    assert.equal(windowLengthCm(1800, "regular"), 600);
  });
  test("100 cm spacing repeats from the fixed end", () => {
    assert.deepEqual(windowDividerFractions(dynamic(450), 80).map(t => Math.round(t * 450)), [100, 200, 300, 400]);
  });
  test("20 cm end tolerance removes the divider exactly 20 cm before the end", () => {
    assert.deepEqual(windowDividerFractions(dynamic(320), 80).map(t => Math.round(t * 320)), [100, 200]);
    assert.deepEqual(windowDividerFractions(dynamic(321), 80).map(t => Math.round(t * 321)), [100, 200, 300]);
  });
  test("short windows have no interior divider and zero tolerance never duplicates end frame", () => {
    assert.deepEqual(windowDividerFractions(dynamic(50), 80), []);
    assert.deepEqual(windowDividerFractions(dynamic(300, 0), 80).map(t => Math.round(t * 300)), [100, 200]);
  });
  test("normalization preserves long length and settings", () => {
    const window = normalizeWindow({ ...dynamic(1250), widthCm: 1250, dividerSpacingCm: 125, endToleranceCm: 30 });
    assert.equal(window?.widthCm, 1250);
    assert.equal(window?.dividerSpacingCm, 125);
    assert.equal(window?.endToleranceCm, 30);
  });
  test("regular and dynamic windows use identical frame bounds", () => {
    assert.deepEqual(windowPlanGeometry(dynamic(50), 80), windowPlanGeometry({ a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }, 80));
  });
});