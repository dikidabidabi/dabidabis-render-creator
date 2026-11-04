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
const angleDistance = (a: number, b: number) => Math.abs(normalizedAngle(a - b));
const normalSide = (n: DimensionPoint): DimensionSide => Math.abs(n.x) > Math.abs(n.y) ? (n.x < 0 ? "left" : "right") : (n.y < 0 ? "top" : "bottom");
const unique = (values: number[], tolerance: number) => values.filter(Number.isFinite).sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > tolerance);
/** Project room endpoints onto all four rails of the grid frame, never room-edge angles. */
export function exteriorRoomChains(rooms: { id: string; points: DimensionPoint[] }[], tolerance: number, grids: DimensionGrid[] = [], fallbackRotation = 0): ExteriorChain[] {
  const points = rooms.flatMap((room) => room.points).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 2) return [];
  const rotations = unique(grids.length ? grids.map((grid) => normalizedAngle(grid.rotation)) : [normalizedAngle(fallbackRotation)], 0.01);
  return rotations.flatMap((rotation) => [rotation, rotation + 90].flatMap((rawAngle) => {
    const angle = normalizedAngle(rawAngle), { u, n } = dimensionBasis(angle);
    const coordinates = unique(points.map((p) => dot(p, u)), tolerance);
    if (coordinates.length < 2) return [];
    const cross = points.map((p) => dot(p, n));
    return [-1, 1].map((outward) => ({
      side: normalSide({ x: n.x * outward, y: n.y * outward }), angle, coordinates,
      face: outward < 0 ? Math.min(...cross) : Math.max(...cross), outward,
      roomIds: rooms.map((room) => room.id),
    }));
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
