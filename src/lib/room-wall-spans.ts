import type { Point, StraightLineInput } from "./edge-segments";

type BoundaryLine = StraightLineInput & { bulge?: number; c1?: Point; c2?: Point };
export type RoomWallSpan = { a: Point; b: Point; sideIndex: number; length: number };

/** Match the 24-step curve tessellation used when Sketch builds room polygons. */
function linePoints(line: BoundaryLine): Point[] {
  if ((line.kind ?? "straight") === "straight") return [line.a, line.b];
  const dx = line.b.x - line.a.x, dy = line.b.y - line.a.y;
  const length = Math.hypot(dx, dy) || 1;
  const control = {
    x: (line.a.x + line.b.x) / 2 - 2 * dy / length * (line.bulge ?? 0),
    y: (line.a.y + line.b.y) / 2 + 2 * dx / length * (line.bulge ?? 0),
  };
  const c1 = line.c1 ?? line.a, c2 = line.c2 ?? line.b;
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24, mt = 1 - t;
    return line.kind === "arc" ? {
      x: mt * mt * line.a.x + 2 * mt * t * control.x + t * t * line.b.x,
      y: mt * mt * line.a.y + 2 * mt * t * control.y + t * t * line.b.y,
    } : {
      x: mt ** 3 * line.a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * line.b.x,
      y: mt ** 3 * line.a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * line.b.y,
    };
  });
}

/** Only positive collinear overlaps with actual sketch lines count as walls.
 * Merge overlapping/duplicate lines so each room surface is counted once.
 * Doors/windows do not remove the underlying line from this gross-area measure.
 */
export function roomWallSpans(
  points: Point[], lines: BoundaryLine[], levelId: string | undefined, tolerance = 0.001,
): RoomWallSpan[] {
  if (points.length < 3) return [];
  const segments = lines.filter((line) => line.levelId === levelId).flatMap((line) => {
    const sampled = linePoints(line);
    return sampled.slice(1).map((b, index) => ({ a: sampled[index], b }));
  });
  return points.flatMap((a, sideIndex) => {
    const b = points[(sideIndex + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= 1e-6) return [];
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
    const intervals: [number, number][] = [];
    for (const segment of segments) {
      const distanceA = Math.abs((segment.a.x - a.x) * uy - (segment.a.y - a.y) * ux);
      const distanceB = Math.abs((segment.b.x - a.x) * uy - (segment.b.y - a.y) * ux);
      if (distanceA > tolerance || distanceB > tolerance) continue;
      const start = (segment.a.x - a.x) * ux + (segment.a.y - a.y) * uy;
      const end = (segment.b.x - a.x) * ux + (segment.b.y - a.y) * uy;
      const lo = Math.max(0, Math.min(start, end)), hi = Math.min(length, Math.max(start, end));
      if (hi - lo > 1e-6) intervals.push([lo, hi]);
    }
    intervals.sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (last && interval[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    return merged.map(([lo, hi]) => ({
      a: { x: a.x + ux * lo, y: a.y + uy * lo },
      b: { x: a.x + ux * hi, y: a.y + uy * hi },
      sideIndex, length: hi - lo,
    }));
  });
}