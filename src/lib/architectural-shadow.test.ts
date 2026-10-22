import { test } from "node:test";
import { strict as assert } from "node:assert";
import { architecturalShadowProfile } from "./architectural-shadow";
import { architecturalShadowStrips, architecturalWallUnion } from "./architectural-plan";

test("window frame shadow reaches 150 cm at 45 degrees like the walls", () => {
  const { steps } = architecturalShadowProfile(100, 1.5);
  assert.equal(steps[0].distance, 150);
  const base = architecturalWallUnion([[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 15 }, { x: 0, y: 15 }]], []);
  const points = architecturalShadowStrips(base, steps[0].distance).flat();
  assert.ok(Math.abs(Math.max(...points.map(p => p.x)) - 100 - 150 / Math.SQRT2) < 1e-8);
  assert.ok(Math.abs(Math.max(...points.map(p => p.y)) - 15 - 150 / Math.SQRT2) < 1e-8);
});

test("window and wall shadows have identical darkness", () => {
  const window = architecturalShadowProfile(100, 1.5);
  const wall = architecturalShadowProfile(100, 1.5);
  assert.equal(window.opacity, wall.opacity);
  assert.ok(Math.abs(1 - (1 - window.opacity) ** window.steps.length - 0.456) < 1e-8);
});

test("window shadow blur grows with distance", () => {
  const { steps } = architecturalShadowProfile(100, 1.5);
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i - 1].distance > steps[i].distance);
    assert.ok(steps[i - 1].blur > steps[i].blur);
  }
});
