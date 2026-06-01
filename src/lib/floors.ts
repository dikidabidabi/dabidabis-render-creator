// Lantai (slab) — entitas terpisah dari layer/ruang. Top permukaan sejajar
// MDPL level, di-extrude 150mm ke arah BAWAH (3D: -Y world setelah konversi).
//
// Mode input UI:
//   - rect     : drag persegi
//   - line     : satu garis tunggal (alias UI; secara teknis polyline 2 titik)
//   - polyline : klik banyak titik, tutup di titik awal
//   - attach   : klik satu segmen pada perimeter tertutup → outer; klik segmen
//                lain pada lubang dalamnya → hole. Komit lewat tombol "Selesai".

export type Point = { x: number; y: number };

export type FloorMode = "rect" | "line" | "polyline" | "attach";

export type Floor = {
  id: string;
  levelId: string;
  outer: Point[];        // ring poligon terluar (urutan vertex, tidak ditutup)
  holes?: Point[][];     // ring lubang (void)
  thicknessMm: number;   // default 150
  createdAt: number;
};

export const FLOOR_THICKNESS_MM = 150;

export function genFloorId(): string {
  return `FL${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function polygonAreaPx(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(s) / 2;
}

export function polygonSignedAreaPx(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return s / 2;
}

/** Pastikan ring berorientasi CCW (untuk outer) atau CW (untuk hole) — true = CCW. */
export function ensureWinding(pts: Point[], wantCCW: boolean): Point[] {
  const sgn = polygonSignedAreaPx(pts);
  const isCCW = sgn > 0;
  return isCCW === wantCCW ? pts : pts.slice().reverse();
}

export function polygonCentroid(pts: Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    cx += (pts[i].x + pts[j].x) * cross;
    cy += (pts[i].y + pts[j].y) * cross;
    a += cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-6) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Cycle terkecil yang melewati segmen (a,b) tertentu di dalam graf garis-garis.
 *  Mirip findCycleWithLine di sketch.tsx, tapi standalone agar bisa dipakai
 *  ulang untuk mode "Attach Garis". snapTolPx menyamakan endpoint yang dekat. */
export function findCycleThroughSegment(
  segs: { a: Point; b: Point }[],
  segIdx: number,
  snapTolPx: number,
): Point[] | null {
  if (segs.length < 3) return null;
  const keyOf = (p: Point) => `${Math.round(p.x / snapTolPx)}_${Math.round(p.y / snapTolPx)}`;
  const adj = new Map<string, { to: string; segIdx: number; toPt: Point }[]>();
  const ensure = (k: string) => {
    if (!adj.has(k)) adj.set(k, []);
    return adj.get(k)!;
  };
  segs.forEach((s, i) => {
    const ka = keyOf(s.a);
    const kb = keyOf(s.b);
    if (ka === kb) return;
    ensure(ka).push({ to: kb, segIdx: i, toPt: s.b });
    ensure(kb).push({ to: ka, segIdx: i, toPt: s.a });
  });
  const target = segs[segIdx];
  const startK = keyOf(target.a);
  const goalK = keyOf(target.b);
  if (startK === goalK) return null;
  const prev = new Map<string, { from: string; segIdx: number; pt: Point } | null>();
  prev.set(startK, null);
  const queue: string[] = [startK];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === goalK) break;
    for (const e of adj.get(cur) ?? []) {
      if (e.segIdx === segIdx) continue;
      if (prev.has(e.to)) continue;
      prev.set(e.to, { from: cur, segIdx: e.segIdx, pt: e.toPt });
      queue.push(e.to);
    }
  }
  if (!prev.has(goalK)) return null;
  const orderedPts: Point[] = [];
  let cur: string | null = goalK;
  const reversed: Point[] = [];
  while (cur && cur !== startK) {
    const entry = prev.get(cur);
    if (!entry) return null;
    reversed.push(entry.pt);
    cur = entry.from;
  }
  // start vertex
  orderedPts.push(target.a);
  // walk start -> ... -> goal
  for (let i = reversed.length - 1; i >= 0; i--) orderedPts.push(reversed[i]);
  // closing edge is target itself, no extra point
  if (orderedPts.length < 3) return null;
  // dedupe near-duplicates
  const dedup: Point[] = [];
  for (const p of orderedPts) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > snapTolPx * 0.5) dedup.push(p);
  }
  if (dedup.length < 3) return null;
  return dedup;
}

/** Jarak titik ke segmen (untuk picking segmen terdekat). */
export function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx, y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

/** Test point-in-polygon untuk validasi hole berada di dalam outer. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
