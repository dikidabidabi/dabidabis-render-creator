import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { Point } from "@/lib/edge-segments";

export type PlanPolygons = Point[][][];
const toPolygon = (points: Point[]): Polygon => [points.map(({ x, y }) => [x, y])];
const fromMultiPolygon = (polygons: MultiPolygon): PlanPolygons => polygons.map((polygon) =>
  polygon.map((ring) => ring.map(([x, y]) => ({ x, y }))));

/** Merge walls and columns first, then cut openings out of the actual shadow caster. */
export function architecturalWallUnion(bands: Point[][], openings: Point[][]): PlanPolygons {
  const first = bands[0];
  if (!first) return [];
  const walls = polygonClipping.union(toPolygon(first), ...bands.slice(1).map(toPolygon));
  return fromMultiPolygon(openings.length
    ? polygonClipping.difference(walls, ...openings.map(toPolygon))
    : walls);
}

/** Continuous projected shadow from the wall to the requested distance at 45 degrees. */
export function architecturalShadowSweep(walls: PlanPolygons, distance: number): PlanPolygons {
  const shift = distance / Math.SQRT2;
  const bands: Point[][] = [];
  for (const polygon of walls) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        bands.push([a, b, { x: b.x + shift, y: b.y + shift }, { x: a.x + shift, y: a.y + shift }]);
      }
    }
  }
  return architecturalWallUnion(bands, []);
}

/** Inset bevel strips on the merged perimeter, including door reveals and column corners. */
export function architecturalBevels(walls: PlanPolygons, width: number) {
  return walls.flatMap((polygon) => polygon.flatMap((ring) => {
    const signedArea = ring.slice(0, -1).reduce((sum, a, i) => {
      const b = ring[i + 1];
      return sum + a.x * b.y - b.x * a.y;
    }, 0);
    // Clipping outputs exterior rings counterclockwise and holes clockwise.
    // The filled side is always to the left of each oriented edge.
    return ring.slice(0, -1).flatMap((a, i) => {
      const b = ring[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-8 || Math.abs(signedArea) < 1e-8) return [];
      const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
      return [{ points: [a, b, { x: b.x + nx * width, y: b.y + ny * width },
        { x: a.x + nx * width, y: a.y + ny * width }], light: nx + ny > 0,
        a, b, inner: { x: (a.x + b.x) / 2 + nx * width, y: (a.y + b.y) / 2 + ny * width } }];
    });
  }));
}