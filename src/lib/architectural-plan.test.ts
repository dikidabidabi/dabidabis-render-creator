import { describe, expect, test } from "bun:test";
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
    expect(walls).toHaveLength(2);
    expect(area(walls)).toBeCloseTo(1.245, 6);
  });
  test("shadow reaches 150 cm at 45 degrees with an actual doorway gap", () => {
    const walls = architecturalWallUnion([rect(0, 0, 10, 0.15)], [rect(4, -1, 2, 2)]);
    const shadow = architecturalShadowSweep(walls, 1.5);
    const points = shadow.flat(2);
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(0.15 + 1.5 / Math.SQRT2);
    expect(shadow).toHaveLength(2);
  });
  test("bevel follows only the union perimeter at 2 cm", () => {
    const walls = architecturalWallUnion([rect(0, 0, 2, 0.15), rect(1, 0, 2, 0.15)], []);
    const bevels = architecturalBevels(walls, 0.02);
    expect(bevels.some((b) => b.light)).toBe(true);
    expect(bevels.some((b) => !b.light)).toBe(true);
    for (const bevel of bevels) {
      expect(Math.hypot(bevel.points[3].x - bevel.a.x, bevel.points[3].y - bevel.a.y)).toBeCloseTo(0.02);
    }
    expect(architecturalWallUnion([], [])).toEqual([]);
  });
});