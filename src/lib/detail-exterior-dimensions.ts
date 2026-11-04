import { xAxisLabelAt, yAxisLabelAt } from "@/lib/structural-grid";

export type DimensionPoint = { x: number; y: number };
export type DimensionSide = "top" | "bottom" | "left" | "right";
export type ExteriorChain = {
  side: DimensionSide; angle: number; coordinates: number[]; face: number;
  outward: number; roomIds?: string[]; gridIndex?: number;
};
export type DimensionGrid = { gridIndex: number; origin: DimensionPoint; rotation: number; xs: number[]; ys: number[] };
const dot = (p: DimensionPoint, q: DimensionPoint) => p.x * q.x + p.y * q.y;
export const dimensionBasis = (angle: number) => {
  const r = angle * Math.PI / 180;
  return { u: { x: Math.cos(r), y: Math.sin(r) }, n: { x: -Math.sin(r), y: Math.cos(r) } };
};
const normalizedAngle = (a: number) => ((a + 90) % 180 + 180) % 180 - 90;
const normalSide = (n: DimensionPoint): DimensionSide => Math.abs(n.x) > Math.abs(n.y) ? (n.x < 0 ? "left" : "right") : (n.y < 0 ? "top" : "bottom");
const unique = (values: number[], tolerance: number) => values.filter(Number.isFinite).sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > tolerance);
/** Project room endpoints onto all four rails of the grid frame, never room-edge angles. */
export function exteriorRoomChains(rooms: { id: string; points: DimensionPoint[] }[], tolerance: number, grids: DimensionGrid[] = [], fallbackRotation = 0): ExteriorChain[] {
  const points = rooms.flatMap((room) => room.points).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 2) return [];
  const rotations = unique(grids.length ? grids.map((grid) => normalizedAngle(grid.rotation)) : [normalizedAngle(fallbackRotation)], 0.01);
  return rotations.flatMap((rotation) => [rotation, rotation + 90].flatMap((rawAngle) => {
    const angle = normalizedAngle(rawAngle), { u, n } = dimensionBasis(angle);
    const cross = points.map((p) => dot(p, n));
    const minCross = Math.min(...cross), maxCross = Math.max(...cross);
    return [-1, 1].flatMap((outward) => {
      const face = outward < 0 ? minCross : maxCross;
      // Ruang terluar diukur lokal per posisi sepanjang sisi: sebuah ruang
      // menyumbang proyeksi tarikan dimensi bila tidak ada ruang lain yang
      // tumpang tindih rentangnya dan menjorok lebih keluar darinya. Dengan
      // begitu bangunan berbentuk L tetap terukur di kedua segmen sisinya.
      const outerRooms = rooms.filter((room) => {
        const roomCross = room.points.map((p) => dot(p, n));
        const roomU = room.points.map((p) => dot(p, u));
        const extent = outward < 0 ? Math.min(...roomCross) : Math.max(...roomCross);
        const uMin = Math.min(...roomU), uMax = Math.max(...roomU);
        return !rooms.some((other) => {
          if (other === room) return false;
          const otherU = other.points.map((p) => dot(p, u));
          const overlap = Math.min(uMax, Math.max(...otherU)) - Math.max(uMin, Math.min(...otherU));
          if (overlap <= tolerance) return false;
          const otherCross = other.points.map((p) => dot(p, n));
          const otherExtent = outward < 0 ? Math.min(...otherCross) : Math.max(...otherCross);
          return outward < 0 ? otherExtent < extent - tolerance : otherExtent > extent + tolerance;
        });
      });
      const coordinates = unique(outerRooms.flatMap((room) => room.points).map((p) => dot(p, u)), tolerance);
      if (coordinates.length < 2) return [];
      return [{
        side: normalSide({ x: n.x * outward, y: n.y * outward }), angle, coordinates, face, outward,
        roomIds: outerRooms.map((room) => room.id),
      }];
    });
  }));
}
/** Four grid boundaries, never internal grid lines or screen-axis projections. */
export function exteriorGridChains(grids: DimensionGrid[], roomChains: ExteriorChain[], tolerance: number): ExteriorChain[] {
  const candidates = grids.flatMap(({ gridIndex, origin, rotation, xs, ys }) => {
    if (xs.length < 2 || ys.length < 2) return [];
    const r = rotation * Math.PI / 180;
    const rotate = (x: number, y: number) => ({ x: origin.x + (x - origin.x) * Math.cos(r) - (y - origin.y) * Math.sin(r), y: origin.y + (x - origin.x) * Math.sin(r) + (y - origin.y) * Math.cos(r) });
    return [
      { points: xs.map((x) => rotate(x, ys[0])), normal: { x: Math.sin(r), y: -Math.cos(r) } },
      { points: xs.map((x) => rotate(x, ys[ys.length - 1])), normal: { x: -Math.sin(r), y: Math.cos(r) } },
      { points: ys.map((y) => rotate(xs[0], y)), normal: { x: -Math.cos(r), y: -Math.sin(r) } },
      { points: ys.map((y) => rotate(xs[xs.length - 1], y)), normal: { x: Math.cos(r), y: Math.sin(r) } },
    ].map(({ points, normal }) => {
      const a = points[0], b = points[points.length - 1];
      const angle = normalizedAngle(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI), { u, n } = dimensionBasis(angle);
      return { side: normalSide(normal), angle, coordinates: unique(points.map((p) => dot(p, u)), tolerance), face: dot(a, n), outward: Math.sign(dot(normal, n)), gridIndex };
    });
  });
  // Keep all four sides of every grid, including grids sharing an orientation.
  void roomChains; void tolerance;
  return candidates;
}
/** Label sumbu per rantai grid: bubble angka pada rantai horizontal, huruf pada rantai vertikal. */
export function gridChainAxisLabels(
  chain: ExteriorChain,
  grids: { gridIndex: number; origin: DimensionPoint; rotation: number; xs: number[]; ys: number[]; labelOffsetX?: number; labelOffsetY?: number }[],
  tolerance: number,
): string[] {
  const grid = grids.find((candidate) => candidate.gridIndex === chain.gridIndex);
  if (!grid) return [];
  const r = grid.rotation * Math.PI / 180;
  const rotate = (x: number, y: number) => ({
    x: grid.origin.x + (x - grid.origin.x) * Math.cos(r) - (y - grid.origin.y) * Math.sin(r),
    y: grid.origin.y + (x - grid.origin.x) * Math.sin(r) + (y - grid.origin.y) * Math.cos(r),
  });
  const { u } = dimensionBasis(chain.angle);
  // Rantai sejajar as x grid memakai angka; sejajar as y memakai huruf.
  const gx = { x: Math.cos(r), y: Math.sin(r) };
  const alongX = Math.abs(dot(u, gx)) >= Math.abs(-u.x * gx.y + u.y * gx.x);
  const horizontal = alongX;
  const axisCount = (horizontal ? grid.xs : grid.ys).length;
  if (axisCount < 1) return [];
  // Nilai proyeksi tiap as pada kedua batas grid; rantai sisi tertentu
  // memakai nilai batas yang terdekat, sehingga urutan label tetap benar
  // walau arah rantai dinormalisasi terbalik.
  const axisProjections = (horizontal ? grid.xs : grid.ys).map((value) => {
    const ends = horizontal
      ? [rotate(value, grid.ys[0]), rotate(value, grid.ys[grid.ys.length - 1])]
      : [rotate(grid.xs[0], value), rotate(grid.xs[grid.xs.length - 1], value)];
    return ends.map((p) => dot(p, u));
  });
  return chain.coordinates.map((coordinate) => {
    let best = -1, bestDist = Infinity;
    axisProjections.forEach((ends, index) => {
      for (const value of ends) {
        const distance = Math.abs(value - coordinate);
        if (distance < bestDist) { bestDist = distance; best = index; }
      }
    });
    if (best < 0 || bestDist > tolerance) return "";
    return horizontal
      ? xAxisLabelAt(best, grid.labelOffsetX ?? 0)
      : yAxisLabelAt(best, grid.labelOffsetY ?? 0);
  });
}
