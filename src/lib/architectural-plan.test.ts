import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { architecturalWallUnion, architecturalShadowSweep, architecturalShadowStrips, architecturalBevels, architecturalWindowBases } from "./architectural-plan";

import { windowPlanGeometry } from "./windows";

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const area = (polygons: ReturnType<typeof architecturalWallUnion>) => polygons.reduce((total, polygon) =>
  total + polygon.reduce((sum, ring) => sum + ring.slice(0, -1).reduce((s, a, i) => {
    const b = ring[i + 1];
    return s + a.x * b.y - b.x * a.y;
  }, 0) / 2, 0), 0);

describe("architectural walls", () => {
  test("window cut preserves walls and columns outside its exact frame", () => {
    const geometry = windowPlanGeometry({ a: { x: 4, y: 0 }, b: { x: 6, y: 0 } }, 1,
      [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thicknessMm: 150 }]);
    assert.ok(geometry);
    assert.deepEqual(geometry.footprint, [
      { x: 4, y: 0.075 }, { x: 6, y: 0.075 }, { x: 6, y: -0.075 }, { x: 4, y: -0.075 },
    ]);
    const bands = [rect(0, -0.075, 10, 0.15), rect(4, 0.1, 2, 0.15), rect(3.8, -0.15, 0.2, 0.3)];
    const before = architecturalWallUnion(bands, []), after = architecturalWallUnion(bands, [geometry.footprint]);
    assert.ok(Math.abs(area(before) - area(after) - 0.3) < 1e-6);
    for (const untouched of [bands[1], bands[2]]) {
      assert.ok(Math.abs(area(architecturalWindowBases(after, [untouched])) - area(architecturalWallUnion([untouched], []))) < 1e-6);
    }
  });
  test("rotated cuts follow actual frame depth without extending the endpoints", () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
      const a = { x: 3, y: 5 }, dx = Math.cos(angle), dy = Math.sin(angle);
      const b = { x: a.x + 2 * dx, y: a.y + 2 * dy };
      const geometry = windowPlanGeometry({ a, b }, 80, [{ a, b, thicknessMm: 300 }]);
      assert.ok(geometry);
      assert.equal(geometry.halfDepth, 12);
      for (const [i, p] of geometry.footprint.entries()) {
        const along = (p.x - a.x) * dx + (p.y - a.y) * dy;
        const across = -(p.x - a.x) * dy + (p.y - a.y) * dx;
        assert.ok(Math.abs(along - (i === 1 || i === 2 ? 2 : 0)) < 1e-8);
        assert.ok(Math.abs(Math.abs(across) - 12) < 1e-8);
      }
    }
  });
  test("window trims both ends and retains its lower footprint", () => {
    const bands = [rect(0, 0, 10, 0.15)], opening = rect(4, -1, 2, 2);
    const walls = architecturalWallUnion(bands, [opening]);
    const bases = architecturalWindowBases(architecturalWallUnion(bands, []), [opening]);
    assert.equal(walls.length, 2);
    assert.ok(Math.abs(area(walls) - 1.2) < 1e-6);
    assert.ok(Math.abs(area(bases) - 0.3) < 1e-6);
    assert.deepEqual([...new Set(bases.flat(2).map(p => p.x))].sort(), [4, 6]);
  });
  test("wall end casts onto the lower window footprint", () => {
    const shadow = architecturalShadowSweep(architecturalWallUnion([rect(0, 0, 10, 0.15)], [rect(4, -1, 2, 2)]), 1.5);
    assert.ok(area(architecturalWindowBases(shadow, [rect(4, 0, 2, 0.15)])) > 0);
  });
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
  test("45 degree walls render all shadow layers without output-ring errors", () => {
    const walls = architecturalWallUnion([[
      { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 102, y: 98 }, { x: 2, y: -2 },
    ]], []);
    for (let i = 1; i <= 16; i++) {
      const shadow = architecturalShadowSweep(walls, i * 1.5);
      assert.ok(shadow.length > 0);
      assert.ok(shadow.flat(2).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    }
  });
  test("invalid and zero-area bands do not crash the slide", () => {
    const walls = architecturalWallUnion([
      rect(0, 0, 10, 0.15), rect(0, 0, 0, 2), rect(Number.NaN, 0, 2, 2),
    ], [rect(4, -1, 2, 2), rect(0, 0, 0, 1)]);
    assert.equal(walls.length, 2);
    assert.ok(Math.abs(area(walls) - 1.2) < 1e-6);
    assert.deepEqual(architecturalShadowSweep(walls, 0), []);
    assert.deepEqual(architecturalShadowSweep(walls, Number.NaN), []);
  });
  test("shadow strips share orientation and skip degenerate edges", () => {
    const walls = architecturalWallUnion([rect(0, 0, 10, 0.15), [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 5.1, y: 4.9 }, { x: 0.1, y: -0.1 }]], []);
    const strips = architecturalShadowStrips(walls, 1.5);
    assert.ok(strips.length > 0);
    for (const strip of strips) {
      const signed = strip.reduce((sum, p, i) => sum + p.x * strip[(i + 1) % strip.length].y - strip[(i + 1) % strip.length].x * p.y, 0);
      assert.ok(signed > 0);
    }
    assert.deepEqual(architecturalShadowStrips(walls, 0), []);
  });
});
