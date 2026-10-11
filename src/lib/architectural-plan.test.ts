import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { architecturalWallUnion, architecturalShadowSweep, architecturalBevels } from "./architectural-plan";

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const area = (polygons: ReturnType<typeof architecturalWallUnion>) => polygons.reduce((total, polygon) =>
  total + polygon.reduce((sum, ring) => sum + ring.slice(0, -1).reduce((s, a, i) => {
    const b = ring[i + 1];
    return s + a.x * b.y - b.x * a.y;
  }, 0) / 2, 0), 0);

describe("architectural walls", () => {
  test("door opening splits the wall and column overlaps are merged", () => {
    const walls = architecturalWallUnion([rect(0, 0, 10, 0.15), rect(0, 0, 0.3, 0.3)], [rect(4, -1, 2, 2)]);
    assert.equal(walls.length, 2);
    assert.ok(Math.abs(area(walls) - 1.245) < 1e-6);
  });
  test("shadow reaches 150 cm at 45 degrees with an actual doorway gap", () => {
    const walls = architecturalWallUnion([rect(0, 0, 10, 0.15)], [rect(4, -1, 2, 2)]);
    const shadow = architecturalShadowSweep(walls, 1.5);
    const points = shadow.flat(2);
    assert.ok(Math.abs(Math.max(...points.map((p) => p.y)) - (0.15 + 1.5 / Math.SQRT2)) < 1e-6);
    assert.equal(shadow.length, 2);
  });
  test("bevel follows only the union perimeter at 2 cm", () => {
    const walls = architecturalWallUnion([rect(0, 0, 2, 0.15), rect(1, 0, 2, 0.15)], []);
    const bevels = architecturalBevels(walls, 0.02);
    assert.ok(bevels.some((b) => b.light));
    assert.ok(bevels.some((b) => !b.light));
    for (const bevel of bevels) {
      assert.ok(Math.abs(Math.hypot(bevel.points[3].x - bevel.a.x, bevel.points[3].y - bevel.a.y) - 0.02) < 1e-6);
    }
    assert.deepEqual(architecturalWallUnion([], []), []);
  });
});