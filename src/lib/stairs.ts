export type Point = { x: number; y: number };

export type StairKind = "lurus" | "u" | "lingkar";

export type Stair = {
  id: string;
  levelId: string;
  toLevelId: string;
  kind: StairKind;
  a: Point;
  b: Point;
  widthM: number;
  stepCount: number;
  landing: boolean;
  offsetM: number;
  innerRadiusM: number;
  createdAt: number;
};

export type StairPlan = {
  footprint: Point[];
  stepLines: Array<[Point, Point]>;
  path: Point[];
  landings: Point[][];
  totalRunM: number;
};

export const DEFAULT_STAIR_WIDTH_M = 1.2;
export const DEFAULT_STAIR_STEPS = 18;
export const DEFAULT_STAIR_OFFSET_M = 0.2;
export const DEFAULT_STAIR_INNER_RADIUS_M = 0.45;

export function genStairId() {
  return `ST${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const finite = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function normalizeStairs(raw: unknown, validLevelIds: Set<string>): Stair[] {
  if (!Array.isArray(raw)) return [];
  const out: Stair[] = [];
  for (const value of raw as any[]) {
    if (!value || typeof value !== "object") continue;
    const ax = Number(value.a?.x), ay = Number(value.a?.y);
    const bx = Number(value.b?.x), by = Number(value.b?.y);
    if (![ax, ay, bx, by].every(Number.isFinite)) continue;
    if (!validLevelIds.has(value.levelId) || !validLevelIds.has(value.toLevelId)) continue;
    out.push({
      id: typeof value.id === "string" && value.id ? value.id : genStairId(),
      levelId: value.levelId,
      toLevelId: value.toLevelId,
      kind: value.kind === "u" || value.kind === "lingkar" ? value.kind : "lurus",
      a: { x: ax, y: ay }, b: { x: bx, y: by },
      widthM: Math.max(0.6, finite(value.widthM, DEFAULT_STAIR_WIDTH_M)),
      stepCount: Math.max(2, Math.round(finite(value.stepCount, DEFAULT_STAIR_STEPS))),
      landing: value.landing === true,
      offsetM: Math.max(0, finite(value.offsetM, DEFAULT_STAIR_OFFSET_M)),
      innerRadiusM: Math.max(0.1, finite(value.innerRadiusM, DEFAULT_STAIR_INNER_RADIUS_M)),
      createdAt: finite(value.createdAt, Date.now()),
    });
  }
  return out;
}

function frame(stair: Stair) {
  const dx = stair.b.x - stair.a.x, dy = stair.b.y - stair.a.y;
  const lengthPx = Math.max(1, Math.hypot(dx, dy));
  const u = { x: dx / lengthPx, y: dy / lengthPx };
  const v = { x: -u.y, y: u.x };
  const at = (along: number, across: number): Point => ({
    x: stair.a.x + u.x * along + v.x * across,
    y: stair.a.y + u.y * along + v.y * across,
  });
  return { lengthPx, u, v, at };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function stairPlanGeometry(stair: Stair, pxPerMeter: number): StairPlan {
  const count = Math.max(2, stair.stepCount);
  const { lengthPx, at } = frame(stair);
  const widthPx = Math.max(1, stair.widthM * pxPerMeter);
  if (stair.kind === "lingkar") {
    const inner = Math.max(1, stair.innerRadiusM * pxPerMeter);
    const outer = Math.max(inner + widthPx, lengthPx);
    const angle0 = Math.atan2(stair.b.y - stair.a.y, stair.b.x - stair.a.x);
    const point = (r: number, angle: number): Point => ({ x: stair.a.x + Math.cos(angle) * r, y: stair.a.y + Math.sin(angle) * r });
    const footprint: Point[] = [];
    const segs = Math.max(32, count * 2);
    for (let i = 0; i <= segs; i++) footprint.push(point(outer, angle0 + (Math.PI * 2 * i) / segs));
    for (let i = segs; i >= 0; i--) footprint.push(point(inner, angle0 + (Math.PI * 2 * i) / segs));
    const stepLines: Array<[Point, Point]> = [];
    for (let i = 0; i < count; i++) {
      const a = angle0 + (Math.PI * 2 * i) / count;
      stepLines.push([point(inner, a), point(outer, a)]);
    }
    const path: Point[] = [];
    for (let i = 0; i <= count; i++) path.push(point((inner + outer) / 2, angle0 + (Math.PI * 2 * i) / count));
    return { footprint, stepLines, path, landings: [], totalRunM: (Math.PI * (inner + outer)) / pxPerMeter };
  }
  if (stair.kind === "u") {
    const gap = stair.offsetM * pxPerMeter;
    const totalW = widthPx * 2 + gap;
    const footprint = [at(0, 0), at(lengthPx, 0), at(lengthPx, totalW), at(0, totalW)];
    const landingLen = stair.landing ? Math.min(widthPx, lengthPx * 0.3) : 0;
    const run = Math.max(1, lengthPx - landingLen);
    const first = Math.ceil(count / 2), second = count - first;
    const stepLines: Array<[Point, Point]> = [];
    for (let i = 1; i <= first; i++) stepLines.push([at((run * i) / first, 0), at((run * i) / first, widthPx)]);
    for (let i = 1; i <= second; i++) stepLines.push([at(run - (run * i) / Math.max(1, second), widthPx + gap), at(run - (run * i) / Math.max(1, second), totalW)]);
    const landings = stair.landing ? [[at(run, 0), at(lengthPx, 0), at(lengthPx, totalW), at(run, totalW)]] : [];
    const path = [at(0, widthPx / 2), at(lengthPx, widthPx / 2), at(lengthPx, widthPx + gap + widthPx / 2), at(0, widthPx + gap + widthPx / 2)];
    return { footprint, stepLines, path, landings, totalRunM: (lengthPx * 2 + totalW) / pxPerMeter };
  }
  const half = widthPx / 2;
  const footprint = [at(0, -half), at(lengthPx, -half), at(lengthPx, half), at(0, half)];
  const landingLen = stair.landing ? Math.min(widthPx, lengthPx * 0.3) : 0;
  const run = Math.max(1, lengthPx - landingLen);
  const stepLines: Array<[Point, Point]> = [];
  for (let i = 1; i <= count; i++) stepLines.push([at((run * i) / count, -half), at((run * i) / count, half)]);
  const landings = stair.landing ? [[at(run, -half), at(lengthPx, -half), at(lengthPx, half), at(run, half)]] : [];
  return { footprint, stepLines, path: [at(0, 0), at(lengthPx, 0)], landings, totalRunM: lengthPx / pxPerMeter };
}

export function stairMetrics(stair: Stair, levels: Array<{ id: string; mdpl: number }>, pxPerMeter: number) {
  const from = levels.find((level) => level.id === stair.levelId);
  const to = levels.find((level) => level.id === stair.toLevelId);
  const heightM = Math.abs((to?.mdpl ?? 0) - (from?.mdpl ?? 0));
  const plan = stairPlanGeometry(stair, pxPerMeter);
  return {
    heightM,
    riserM: heightM / Math.max(1, stair.stepCount),
    treadM: plan.totalRunM / Math.max(1, stair.stepCount),
  };
}

export function translateStair(stair: Stair, dx: number, dy: number): Stair {
  return { ...stair, a: { x: stair.a.x + dx, y: stair.a.y + dy }, b: { x: stair.b.x + dx, y: stair.b.y + dy } };
}

export function stairContains(stair: Stair, point: Point, pxPerMeter: number): boolean {
  const poly = stairPlanGeometry(stair, pxPerMeter).footprint;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

export function segmentIntersectsStair(a: Point, b: Point, stair: Stair, pxPerMeter: number): boolean {
  const poly = stairPlanGeometry(stair, pxPerMeter).footprint;
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i], d = poly[(i + 1) % poly.length];
    const c1 = cross(a, b, c), c2 = cross(a, b, d), c3 = cross(c, d, a), c4 = cross(c, d, b);
    if (c1 * c2 <= 0 && c3 * c4 <= 0) return true;
  }
  return stairContains(stair, a, pxPerMeter) || stairContains(stair, b, pxPerMeter);
}