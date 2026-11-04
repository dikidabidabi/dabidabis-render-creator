export type DimensionPoint = { x: number; y: number };
export type DimensionSide = "top" | "bottom" | "left" | "right";
export type ExteriorChain = {
  side: DimensionSide; angle: number; coordinates: number[]; face: number;
  outward: number; roomIds?: string[]; gridIndex?: number;
};
export type DimensionGrid = { gridIndex: number; origin: DimensionPoint; rotation: number; xs: number[]; ys: number[] };
const sides: DimensionSide[] = ["top", "bottom", "left", "right"];
const dot = (p: DimensionPoint, q: DimensionPoint) => p.x * q.x + p.y * q.y;
export const dimensionBasis = (angle: number) => {
  const r = angle * Math.PI / 180;
  return { u: { x: Math.cos(r), y: Math.sin(r) }, n: { x: -Math.sin(r), y: Math.cos(r) } };
};
const normalizedAngle = (a: number) => ((a + 90) % 180 + 180) % 180 - 90;
const angleDistance = (a: number, b: number) => Math.abs(normalizedAngle(a - b));
const normalSide = (n: DimensionPoint): DimensionSide => Math.abs(n.x) > Math.abs(n.y) ? (n.x < 0 ? "left" : "right") : (n.y < 0 ? "top" : "bottom");
const unique = (values: number[], tolerance: number) => values.filter(Number.isFinite).sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > tolerance);
function pointInside(p: DimensionPoint, polygon: DimensionPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Exterior support edges only: interior partitions cannot supply dimension points. */
export function exteriorRoomChains(rooms: { id: string; points: DimensionPoint[] }[], tolerance: number): ExteriorChain[] {
  const edges = rooms.flatMap((room) => {
    const area = room.points.reduce((s, p, i) => { const q = room.points[(i + 1) % room.points.length]; return s + p.x * q.y - q.x * p.y; }, 0);
    return room.points.flatMap((a, i) => {
      const b = room.points[(i + 1) % room.points.length], length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length <= tolerance) return [];
      const normal = { x: (b.y - a.y) / length * Math.sign(area), y: -(b.x - a.x) / length * Math.sign(area) };
      const exposed = [0.2, 0.5, 0.8].some((t) => {
        const p = { x: a.x + (b.x - a.x) * t + normal.x * tolerance, y: a.y + (b.y - a.y) * t + normal.y * tolerance };
        return !rooms.some((other) => other.id !== room.id && pointInside(p, other.points));
      });
      return exposed ? [{ a, b, length, normal, side: normalSide(normal), angle: normalizedAngle(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI), roomId: room.id }] : [];
    });
  });
  return sides.flatMap((side) => {
    const candidates = edges.filter((e) => e.side === side);
    const groups: typeof candidates[] = [];
    for (const edge of candidates) {
      const group = groups.find((g) => angleDistance(g[0].angle, edge.angle) <= 2);
      if (group) group.push(edge); else groups.push([edge]);
    }
    // A repeated room direction wins over an isolated oblique room.
    groups.sort((a, b) => Number(new Set(b.map((e) => e.roomId)).size > 1) - Number(new Set(a.map((e) => e.roomId)).size > 1)
      || new Set(b.map((e) => e.roomId)).size - new Set(a.map((e) => e.roomId)).size
      || b.reduce((s, e) => s + e.length, 0) - a.reduce((s, e) => s + e.length, 0));
    const selected = groups[0];
    if (!selected) return [];
    const longest = [...selected].sort((a, b) => b.length - a.length)[0];
    const angle = longest.angle, { u, n } = dimensionBasis(angle);
    const outward = Math.sign(dot(longest.normal, n));
    const face = outward * Math.max(...selected.flatMap((e) => [dot(e.a, n) * outward, dot(e.b, n) * outward]));
    const outer = selected.filter((e) => Math.abs(dot(e.a, n) - face) <= tolerance * 2 && Math.abs(dot(e.b, n) - face) <= tolerance * 2);
    const coordinates = unique(outer.flatMap((e) => [dot(e.a, u), dot(e.b, u)]), tolerance);
    return coordinates.length >= 2 ? [{ side, angle, face, outward, coordinates, roomIds: [...new Set(outer.map((e) => e.roomId))] }] : [];
  });
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
  return sides.flatMap((side) => {
    const room = roomChains.find((c) => c.side === side);
    let options = candidates.filter((c) => c.side === side);
    if (room) {
      const aligned = options.filter((c) => angleDistance(c.angle, room.angle) <= 2);
      if (aligned.length) options = aligned;
      options = options.filter((c) => {
        if (angleDistance(c.angle, room.angle) > 2) return true;
        return c.coordinates[0] < room.coordinates[room.coordinates.length - 1] + tolerance && c.coordinates[c.coordinates.length - 1] > room.coordinates[0] - tolerance;
      });
    }
    options.sort((a, b) => {
      const axis = side === "top" ? { x: 0, y: -1 } : side === "bottom" ? { x: 0, y: 1 } : side === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 };
      const support = (c: ExteriorChain) => { const { u, n } = dimensionBasis(c.angle); const s = (c.coordinates[0] + c.coordinates[c.coordinates.length - 1]) / 2; return dot({ x: u.x * s + n.x * c.face, y: u.y * s + n.y * c.face }, axis); };
      return support(b) - support(a);
    });
    return options[0] ? [options[0]] : [];
  });
}