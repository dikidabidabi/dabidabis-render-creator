import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { Point } from "@/lib/edge-segments";

export type PlanPolygons = Point[][][];
// Sub-pixel rounding removes floating-point slivers at coincident wall/shadow edges.
const toPolygon = (points: Point[]): Polygon => [points.map(({ x, y }) => [
  Math.round(x * 1e7) / 1e7, Math.round(y * 1e7) / 1e7,
])];
const validBand = (points: Point[]) => points.length >= 3
  && points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))
  && Math.abs(points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + (a.x - points[0].x) * (b.y - points[0].y)
      - (b.x - points[0].x) * (a.y - points[0].y);
  }, 0)) > 1e-8;
const fromMultiPolygon = (polygons: MultiPolygon): PlanPolygons => polygons.map((polygon) =>
  polygon.map((ring) => ring.map(([x, y]) => ({ x, y }))));

/** Merge walls and columns first, then cut openings out of the actual shadow caster. */
export function architecturalWallUnion(bands: Point[][], openings: Point[][]): PlanPolygons {
  const inputs = bands.filter(validBand).map(toPolygon);
  const cuts = openings.filter(validBand).map(toPolygon);
  const first = inputs[0];
  if (!first) return [];
  try {
    const walls = polygonClipping.union(first, ...inputs.slice(1));
    return fromMultiPolygon(cuts.length ? polygonClipping.difference(walls, ...cuts) : walls);
  } catch {
    // A clipping precision failure must not take down the presentation. Keep
    // valid wall bands and cut doors individually instead of losing the plan.
    return inputs.flatMap((polygon) => {
      try {
        return fromMultiPolygon(cuts.length ? polygonClipping.difference(polygon, ...cuts) : [polygon]);
      } catch {
        return fromMultiPolygon([polygon]);
      }
    });
  }
}

/** Continuous projected shadow from the wall to the requested distance at 45 degrees. */
export function architecturalShadowSweep(walls: PlanPolygons, distance: number): PlanPolygons {
  if (!Number.isFinite(distance) || distance <= 0) return [];
  const shift = distance / Math.SQRT2;
  const bands: Point[][] = [];
  for (const polygon of walls) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        // Edges parallel to the light direction sweep zero area. Passing those
        // degenerate quadrilaterals to clipping can throw an output-ring error.
        if (Math.abs((b.x - a.x) - (b.y - a.y)) < 1e-8) continue;
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