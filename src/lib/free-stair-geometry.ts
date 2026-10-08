import polygonClipping from "polygon-clipping";
import type { Point, Stair, StairPlan, StairSectionSurface } from "./stairs";

export function freeStairPlan(stair: Stair, pxPerMeter: number): StairPlan {
  const raw = stair.pathPoints?.length && stair.pathPoints.length >= 2 ? stair.pathPoints : [stair.a, stair.b];
  const points = raw.filter((p, i) => !i || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) > 1e-6);
  if (points.length < 2) return { footprint: [], stepLines: [], innerLines: [], path: points, landings: [], sectionSurfaces: [], totalRunM: 0 };
  const width = Math.max(1, stair.widthM * pxPerMeter), half = width / 2;
  const shift = stair.offsetSide === "left" ? -half : stair.offsetSide === "right" ? half : 0;
  const segments = points.slice(1).map((b, i) => {
    const a = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const n = { x: -u.y, y: u.x };
    return { a, b, length, u, n };
  });
  const path = points.map((p, i) => {
    const prev = segments[Math.max(0, i - 1)], next = segments[Math.min(i, segments.length - 1)];
    const denominator = Math.max(0.25, 1 + prev.n.x * next.n.x + prev.n.y * next.n.y);
    return { x: p.x + shift * (prev.n.x + next.n.x) / denominator, y: p.y + shift * (prev.n.y + next.n.y) / denominator };
  });
  const flights = path.slice(1).map((b, i) => {
    const a = path[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / Math.max(length, 1e-6), y: (b.y - a.y) / Math.max(length, 1e-6) }, n = { x: -u.y, y: u.x };
    const at = (t: number, across: number): Point => ({ x: a.x + u.x * t + n.x * across, y: a.y + u.y * t + n.y * across });
    // Each bend reserves half a stair width from both adjoining flights.
    const start = i ? Math.min(half, length * 0.4) : 0;
    const end = length - (i < segments.length - 1 ? Math.min(half, length * 0.4) : 0);
    return { a, b, length, start, end, run: Math.max(1e-6, end - start), at };
  });
  const total = flights.reduce((sum, f) => sum + f.run, 0);
  const count = Math.max(flights.length, Math.round(stair.stepCount));
  const counts = flights.map((f) => Math.max(1, Math.floor(count * f.run / total)));
  while (counts.reduce((a, b) => a + b, 0) < count) {
    const idx = flights.reduce((best, f, i) => f.run / counts[i] > flights[best].run / counts[best] ? i : best, 0); counts[idx]++;
  }
  while (counts.reduce((a, b) => a + b, 0) > count) {
    const idx = counts.findIndex((n) => n > 1); if (idx < 0) break; counts[idx]--;
  }
  const stepLines: StairPlan["stepLines"] = [], treads: StairSectionSurface[] = [], landings: Point[][] = [], landingSurfaces: StairSectionSurface[] = [];
  let completed = 0;
  flights.forEach((f, i) => {
    for (let j = 0; j < counts[i]; j++) {
      const t0 = f.start + f.run * j / counts[i], t1 = f.start + f.run * (j + 1) / counts[i];
      const polygon = [f.at(t0, -half), f.at(t1, -half), f.at(t1, half), f.at(t0, half)];
      stepLines.push([f.at(t1, -half), f.at(t1, half)]);
      treads.push({ polygon, elevationRatio: (completed + j + 1) / count, kind: "tread" });
    }
    completed += counts[i];
    const next = flights[i + 1];
    if (next) {
      const p = f.b;
      const square = [f.at(f.length - half, -half), f.at(f.length + half, -half), f.at(f.length + half, half), f.at(f.length - half, half)];
      const union = polygonClipping.union([square.map((q) => [q.x, q.y] as [number, number])], [[f.at(f.end, -half), p, next.at(next.start, -half), next.at(next.start, half), f.at(f.end, half)].map((q) => [q.x, q.y] as [number, number])]);
      const landing = union[0]?.[0]?.map(([x, y]) => ({ x, y })) ?? square;
      landings.push(landing); landingSurfaces.push({ polygon: landing, elevationRatio: completed / count, kind: "landing" });
    }
  });
  const polygons = [...treads.map((s) => s.polygon), ...landings];
  const first = polygons[0];
  const union = first ? polygonClipping.union([first.map((p) => [p.x, p.y] as [number, number])], ...polygons.slice(1).map((poly) => [poly.map((p) => [p.x, p.y] as [number, number])])) : [];
  const footprint = union[0]?.[0]?.map(([x, y]) => ({ x, y })) ?? [];
  return { footprint, stepLines, innerLines: [], path, landings, sectionSurfaces: [...treads, ...landingSurfaces], totalRunM: total / pxPerMeter };
}