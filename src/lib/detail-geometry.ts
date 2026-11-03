import { edgeMaterialKey, type EdgeMaterial } from "./edge-segments";
import { pointInRoom, positionFurniture, type DetailFurniture } from "./detail-furniture";

export type DetailPoint = { x: number; y: number };
export type DetailRectangle = { a: DetailPoint; b: DetailPoint; rotation?: number };
export const detailRotation = (area: DetailRectangle) => Number.isFinite(area.rotation) ? Number(area.rotation) : 0;

export function rotateDetailPoint(point: DetailPoint, degrees: number): DetailPoint {
  const angle = degrees * Math.PI / 180;
  return { x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) };
}

export function createDetailRectangle(a: DetailPoint, b: DetailPoint, rotation: number, step = 8): DetailRectangle | null {
  const angle = Number.isFinite(rotation) ? rotation : 0;
  const la = rotateDetailPoint(a, -angle), lb = rotateDetailPoint(b, -angle);
  const snap = (n: number) => Math.round(n / step) * step;
  const min = { x: snap(Math.min(la.x, lb.x)), y: snap(Math.min(la.y, lb.y)) };
  const max = { x: snap(Math.max(la.x, lb.x)), y: snap(Math.max(la.y, lb.y)) };
  if (max.x - min.x < step || max.y - min.y < step) return null;
  return { a: rotateDetailPoint(min, angle), b: rotateDetailPoint(max, angle), rotation: angle };
}

export function detailLocalBounds(area: DetailRectangle, pad = 0) {
  const a = rotateDetailPoint(area.a, -detailRotation(area)), b = rotateDetailPoint(area.b, -detailRotation(area));
  return { minX: Math.min(a.x, b.x) - pad, minY: Math.min(a.y, b.y) - pad, maxX: Math.max(a.x, b.x) + pad, maxY: Math.max(a.y, b.y) + pad };
}

export function detailCorners(area: DetailRectangle): DetailPoint[] {
  const b = detailLocalBounds(area);
  return [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }].map((p) => rotateDetailPoint(p, detailRotation(area)));
}

export function detailWorldBounds(area: DetailRectangle) {
  const points = detailCorners(area);
  return { minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)) };
}

export function detailIntersectsRoom(area: DetailRectangle, polygon: DetailPoint[]): boolean {
  const bounds = detailLocalBounds(area);
  const points = polygon.map((p) => rotateDetailPoint(p, -detailRotation(area)));
  if (points.length < 3) return false;
  const inside = (p: DetailPoint) => p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY;
  if (points.some(inside)) return true;
  const corners = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }];
  if (corners.some((p) => pointInRoom(p, points))) return true;
  return points.some((a, i) => {
    const b = points[(i + 1) % points.length];
    let low = 0, high = 1;
    for (const [start, delta, min, max] of [[a.x, b.x - a.x, bounds.minX, bounds.maxX], [a.y, b.y - a.y, bounds.minY, bounds.maxY]]) {
      if (Math.abs(delta) < 1e-10) { if (start < min || start > max) return false; }
      else {
        const t1 = (min - start) / delta, t2 = (max - start) / delta;
        low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
        if (low > high) return false;
      }
    }
    return true;
  });
}

/** Display-only rotation: persisted coordinates, IDs, dimensions and material selections never change. */
export function orientDetailSketch<T extends {
  layers: { id: string; points: DetailPoint[] }[];
  edgeAttrs?: Record<string, EdgeMaterial>;
  detailAreas?: { furniture?: DetailFurniture[] }[];
}>(sketch: T, rotation: number): T {
  if (!rotation) return sketch;
  const angle = -rotation;
  const visit = (value: unknown, key = ""): unknown => {
    if (["edgeAttrs", "roomAnchor", "columnClips", "pointsLocal", "geo"].includes(key)) return value;
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (!value || typeof value !== "object") return value;
    const raw = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(raw)) out[name] = visit(child, name);
    if (typeof raw.x === "number" && typeof raw.y === "number") Object.assign(out, rotateDetailPoint({ x: raw.x, y: raw.y }, angle));
    if (typeof raw.nx === "number" && typeof raw.ny === "number") {
      const normal = rotateDetailPoint({ x: raw.nx, y: raw.ny }, angle);
      out.nx = normal.x; out.ny = normal.y;
    }
    for (const name of ["rotation", "rotationDeg", "mmGridRotation"]) if (typeof raw[name] === "number") out[name] = raw[name] + angle;
    // Grids with an omitted angle still need the inverse detail rotation.
    if (raw.origin && raw.spansX && raw.rotation == null) out.rotation = angle;
    return out;
  };
  const oriented = visit(sketch) as T;
  const attrs: Record<string, EdgeMaterial> = {};
  for (const [key, material] of Object.entries(sketch.edgeAttrs ?? {})) {
    const [level, endpoints] = key.split("::");
    const points = endpoints?.split("|").map((p) => p.split(",").map(Number));
    const a = points?.[0], b = points?.[1];
    if (!a || !b || ![...a, ...b].every(Number.isFinite)) continue;
    attrs[edgeMaterialKey(level === "__tanpa_level__" ? undefined : level, rotateDetailPoint({ x: a[0], y: a[1] }, angle), rotateDetailPoint({ x: b[0], y: b[1] }, angle))] = material;
  }
  oriented.edgeAttrs = attrs;
  oriented.detailAreas = sketch.detailAreas?.map((area, index) => ({
    ...oriented.detailAreas?.[index],
    furniture: area.furniture?.map((item) => {
      const positioned = positionFurniture(item, sketch.layers);
      return { ...positioned, ...rotateDetailPoint(positioned, angle), rotation: positioned.rotation + angle, roomAnchor: undefined };
    }),
  }));
  return oriented;
}