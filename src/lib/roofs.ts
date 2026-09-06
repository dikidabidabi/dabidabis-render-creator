// Atap (roof) — entitas terpisah dari layer/lantai.
// Layout atap ditentukan oleh GARIS TENGAH (spine/bubungan) yang dapat
// dibelokkan (mis. bentuk L), dan LEBAR atap yang di-offset simetris dari
// garis tengah. Dengan cara ini lebar atap tetap konsisten saat dibelokkan.
//
// Dua jenis:
//   - pelana  : gable — ujung berupa dinding sopi-sopi
//   - limasan : hip   — bubungan diperpendek setengah lebar di kedua ujung
//
// Parameter:
//   - baseHeightM : tinggi tumpuan (eave) di atas MDPL level
//   - slopeDeg    : kemiringan bidang atap (derajat)
//   - widthM      : lebar total atap (offset ±widthM/2 dari garis tengah)
// Tinggi puncak = baseHeightM + (widthM/2) × tan(slope)

export type Point = { x: number; y: number };

export type RoofKind = "pelana" | "limasan";

export type Roof = {
  id: string;
  levelId: string;
  points: Point[];      // footprint (px sketsa) — turunan dari spine + widthM
  spine?: Point[];      // garis tengah atap (px sketsa), 2+ titik
  widthM?: number;      // lebar atap (m)
  kind: RoofKind;
  baseHeightM: number;  // tinggi tumpuan di atas MDPL level
  slopeDeg: number;     // 5..70
  createdAt: number;
};

export const DEFAULT_ROOF_HEIGHT_M = 3;
export const DEFAULT_ROOF_SLOPE_DEG = 30;
export const DEFAULT_ROOF_WIDTH_M = 6;

export function genRoofId(): string {
  return `RF${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeRoofs(raw: unknown, validLevelIds: Set<string>, fallback: string): Roof[] {
  if (!Array.isArray(raw)) return [];
  const out: Roof[] = [];
  const readPts = (v: unknown): Point[] | null => {
    if (!Array.isArray(v)) return null;
    const pts: Point[] = [];
    for (const p of v as any[]) {
      const x = Number(p?.x), y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      pts.push({ x, y });
    }
    return pts;
  };
  for (const r of raw as any[]) {
    if (!r || typeof r !== "object") continue;
    const pts = readPts(r.points);
    const spineRaw = readPts(r.spine);
    const spine = spineRaw && spineRaw.length >= 2 ? spineRaw : undefined;
    if ((!pts || pts.length < 3) && !spine) continue;
    const lid = typeof r.levelId === "string" && validLevelIds.has(r.levelId) ? r.levelId : fallback;
    const h = Number(r.baseHeightM);
    const s = Number(r.slopeDeg);
    const w = Number(r.widthM);
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : genRoofId(),
      levelId: lid,
      points: pts && pts.length >= 3 ? pts : [],
      spine,
      widthM: Number.isFinite(w) && w > 0 ? w : undefined,
      kind: r.kind === "limasan" ? "limasan" : "pelana",
      baseHeightM: Number.isFinite(h) && h >= 0 ? h : DEFAULT_ROOF_HEIGHT_M,
      slopeDeg: Number.isFinite(s) && s > 0 && s < 85 ? s : DEFAULT_ROOF_SLOPE_DEG,
      createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : Date.now(),
    });
  }
  return out;
}

// ---------- Geometri ----------

export type RoofFrame = {
  center: Point;
  eu: Point;   // unit vektor sumbu panjang (px)
  ev: Point;   // unit vektor sumbu pendek (px)
  halfU: number; // px
  halfV: number; // px
};

/** Kotak orientasi (OBB) dari footprint memakai arah sisi terpanjang sebagai acuan. */
export function roofFrame(points: Point[]): RoofFrame | null {
  if (points.length < 3) return null;
  let bx = 1, by = 0, best = -1;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l > best && l > 1e-6) { best = l; bx = dx / l; by = dy / l; }
  }
  let ax = { x: bx, y: by };
  let ay = { x: -by, y: bx };
  const proj = (p: Point, e: Point) => p.x * e.x + p.y * e.y;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of points) {
    const u = proj(p, ax), v = proj(p, ay);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  let lenU = maxU - minU;
  let lenV = maxV - minV;
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  const center = { x: ax.x * cu + ay.x * cv, y: ax.y * cu + ay.y * cv };
  if (lenV > lenU) {
    const t = ax; ax = ay; ay = { x: -t.x, y: -t.y };
    const tl = lenU; lenU = lenV; lenV = tl;
  }
  if (lenU < 1e-6 || lenV < 1e-6) return null;
  return { center, eu: ax, ev: ay, halfU: lenU / 2, halfV: lenV / 2 };
}

function norm(p: Point): Point {
  const l = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / l, y: p.y / l };
}

/** Titik-titik offset satu sisi dari polyline (mitered). side = +1 / -1. */
function offsetSide(spine: Point[], half: number, side: number): Point[] {
  const n = spine.length;
  const dirs: Point[] = [];
  const nrm: Point[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = norm({ x: spine[i + 1].x - spine[i].x, y: spine[i + 1].y - spine[i].y });
    dirs.push(d);
    nrm.push({ x: -d.y * side, y: d.x * side });
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      out.push({ x: spine[0].x + nrm[0].x * half, y: spine[0].y + nrm[0].y * half });
    } else if (i === n - 1) {
      const k = nrm[n - 2];
      out.push({ x: spine[i].x + k.x * half, y: spine[i].y + k.y * half });
    } else {
      const a = nrm[i - 1], b = nrm[i];
      const m = norm({ x: a.x + b.x, y: a.y + b.y });
      const cos = m.x * b.x + m.y * b.y;
      const len = Math.min(half * 4, half / (Math.abs(cos) < 0.2 ? 0.2 : cos));
      out.push({ x: spine[i].x + m.x * len, y: spine[i].y + m.y * len });
    }
  }
  return out;
}

/** Perpendek polyline pada kedua ujung sepanjang `cut` px (untuk limasan). */
function shortenPolyline(pts: Point[], cut: number): Point[] {
  if (cut <= 0 || pts.length < 2) return pts.map((p) => ({ ...p }));
  const total = pts.reduce((s, p, i) => (i === 0 ? 0 : s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)), 0);
  const c = Math.min(cut, total / 2 - 1e-6);
  if (!(c > 0)) {
    const mid = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
    return [mid, { ...mid }];
  }
  const trimStart = (arr: Point[], amount: number): Point[] => {
    const res = arr.map((p) => ({ ...p }));
    let left = amount;
    while (res.length >= 2 && left > 0) {
      const a = res[0], b = res[1];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l <= left + 1e-9) { res.shift(); left -= l; }
      else {
        const t = left / l;
        res[0] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        left = 0;
      }
    }
    return res;
  };
  let r = trimStart(pts, c);
  r = trimStart(r.slice().reverse(), c).reverse();
  return r.length >= 2 ? r : [pts[0], pts[pts.length - 1]];
}

export type RoofGeom = {
  spine: Point[];      // garis tengah (px)
  halfPx: number;      // setengah lebar (px)
  left: Point[];
  right: Point[];
  footprint: Point[];  // polygon footprint (px)
  ridge: Point[];      // polyline bubungan (px), sudah diperpendek utk limasan
};

/** Setengah lebar atap dalam px. Butuh pxPerMeter jika roof memakai widthM. */
export function roofGeom(roof: Roof, pxPerMeter: number): RoofGeom | null {
  if (roof.spine && roof.spine.length >= 2) {
    const halfPx = Math.max(1e-3, ((roof.widthM ?? DEFAULT_ROOF_WIDTH_M) / 2) * pxPerMeter);
    const spine = roof.spine;
    const left = offsetSide(spine, halfPx, 1);
    const right = offsetSide(spine, halfPx, -1);
    const footprint = [...left, ...right.slice().reverse()];
    const ridge = roof.kind === "limasan" ? shortenPolyline(spine, halfPx) : spine.map((p) => ({ ...p }));
    return { spine: spine.map((p) => ({ ...p })), halfPx, left, right, footprint, ridge };
  }
  // Legacy: footprint kotak → turunkan garis tengah dari OBB
  const f = roofFrame(roof.points ?? []);
  if (!f) return null;
  const s0 = { x: f.center.x - f.eu.x * f.halfU, y: f.center.y - f.eu.y * f.halfU };
  const s1 = { x: f.center.x + f.eu.x * f.halfU, y: f.center.y + f.eu.y * f.halfU };
  const spine = [s0, s1];
  const halfPx = f.halfV;
  const left = offsetSide(spine, halfPx, 1);
  const right = offsetSide(spine, halfPx, -1);
  const ridge = roof.kind === "limasan" ? shortenPolyline(spine, halfPx) : spine.map((p) => ({ ...p }));
  return { spine, halfPx, left, right, footprint: roof.points, ridge };
}

/** Footprint polygon (px) untuk roof — dipakai untuk disimpan di roof.points. */
export function roofFootprint(roof: Roof, pxPerMeter: number): Point[] {
  const g = roofGeom(roof, pxPerMeter);
  return g ? g.footprint : (roof.points ?? []);
}

/** Garis bantu gambar plan 2D: bubungan (polyline) + jurai ujung. */
export function roofPlanGeometry(
  roof: Roof,
  pxPerMeter: number,
): { footprint: Point[]; ridge: Point[]; hips: [Point, Point][] } | null {
  const g = roofGeom(roof, pxPerMeter);
  if (!g) return null;
  const n = g.spine.length;
  const r0 = g.ridge[0];
  const r1 = g.ridge[g.ridge.length - 1];
  // Pelana: ujung berupa gable (dinding sopi-sopi) → tanpa garis jurai.
  const hips: [Point, Point][] =
    roof.kind === "limasan"
      ? [
          [g.left[0], r0],
          [g.right[0], r0],
          [g.left[n - 1], r1],
          [g.right[n - 1], r1],
        ]
      : [];
  return { footprint: g.footprint, ridge: g.ridge, hips };
}

/** Legacy helper (kotak) — dipertahankan untuk kompatibilitas. */
export function roofPlanLines(
  points: Point[],
  kind: RoofKind,
): { ridge: [Point, Point]; hips: [Point, Point][]; corners: Point[] } | null {
  const f = roofFrame(points);
  if (!f) return null;
  const rHalf = kind === "limasan" ? Math.max(0, f.halfU - f.halfV) : f.halfU;
  const toW = (u: number, v: number): Point => ({
    x: f.center.x + f.eu.x * u + f.ev.x * v,
    y: f.center.y + f.eu.y * u + f.ev.y * v,
  });
  const r1 = toW(-rHalf, 0);
  const r2 = toW(rHalf, 0);
  const c = [toW(-f.halfU, -f.halfV), toW(f.halfU, -f.halfV), toW(f.halfU, f.halfV), toW(-f.halfU, f.halfV)];
  const hips: [Point, Point][] = [[c[0], r1], [c[3], r1], [c[1], r2], [c[2], r2]];
  return { ridge: [r1, r2], hips, corners: c };
}

/** Tinggi puncak atap (meter) relatif MDPL level. */
export function roofRidgeHeightM(points: Point[], slopeDeg: number, baseHeightM: number, mPerPx: number): number {
  const f = roofFrame(points);
  if (!f) return baseHeightM;
  const halfSpanM = f.halfV * mPerPx;
  return baseHeightM + halfSpanM * Math.tan((slopeDeg * Math.PI) / 180);
}

/** Tinggi puncak (m) relatif MDPL level untuk roof berbasis spine maupun kotak. */
export function roofRidgeHeightOf(roof: Roof, pxPerMeter: number): number {
  const g = roofGeom(roof, pxPerMeter);
  if (!g) return roof.baseHeightM;
  const halfM = g.halfPx / pxPerMeter;
  return roof.baseHeightM + halfM * Math.tan((roof.slopeDeg * Math.PI) / 180);
}

function pointInPoly(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const hit = (yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function distToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best) best = d;
  }
  if (pts.length === 1) best = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  return best;
}

/**
 * Ketinggian permukaan atap (m di atas MDPL level) pada titik px tertentu.
 * Mengembalikan null jika titik di luar footprint atap.
 */
export function roofSurfaceHeightAt(roof: Roof, p: Point, pxPerMeter: number): number | null {
  const g = roofGeom(roof, pxPerMeter);
  if (!g) return null;
  if (!pointInPoly(p, g.footprint)) return null;
  const dM = distToPolyline(p, g.ridge) / pxPerMeter;
  const halfM = g.halfPx / pxPerMeter;
  const rise = Math.max(0, halfM - dM) * Math.tan((roof.slopeDeg * Math.PI) / 180);
  return roof.baseHeightM + rise;
}

/**
 * Triangles (posisi XYZ, meter, Y ke atas) untuk mesh atap berbasis spine.
 * Konvensi: X = (px.x - origin.x) * mPerPx, Z = (px.y - origin.y) * mPerPx.
 */
export function buildRoofMeshPositions(args: {
  roof: Roof;
  origin: Point;
  mPerPx: number;
  baseY: number; // meter — elevasi tumpuan atap (MDPL level + baseHeightM)
}): Float32Array | null {
  const { roof, origin, mPerPx, baseY } = args;
  const pxPerMeter = 1 / mPerPx;
  const g = roofGeom(roof, pxPerMeter);
  if (!g) return null;
  const halfM = g.halfPx * mPerPx;
  const apexY = baseY + halfM * Math.tan((roof.slopeDeg * Math.PI) / 180);
  const V = (p: Point, y: number): [number, number, number] => [
    (p.x - origin.x) * mPerPx, y, (p.y - origin.y) * mPerPx,
  ];
  const n = g.spine.length;
  // Ridge point untuk setiap indeks spine: untuk limasan, ujung memakai titik
  // bubungan terpendek; interior tetap di spine.
  const ridgeAt = (i: number): Point => {
    if (i === 0) return g.ridge[0];
    if (i === n - 1) return g.ridge[g.ridge.length - 1];
    return g.spine[i];
  };
  const tris: [number, number, number][][] = [];
  for (let i = 0; i < n - 1; i++) {
    const L0 = V(g.left[i], baseY), L1 = V(g.left[i + 1], baseY);
    const R0 = V(g.right[i], baseY), R1 = V(g.right[i + 1], baseY);
    const G0 = V(ridgeAt(i), apexY), G1 = V(ridgeAt(i + 1), apexY);
    tris.push([L0, L1, G1], [L0, G1, G0]);
    tris.push([G0, G1, R1], [G0, R1, R0]);
    // dasar
    const b0 = V(g.left[i], baseY), b1 = V(g.left[i + 1], baseY);
    tris.push([b0, b1, V(g.right[i + 1], baseY)], [b0, V(g.right[i + 1], baseY), V(g.right[i], baseY)]);
  }
  // Ujung: sopi-sopi (pelana) atau bidang jurai (limasan)
  tris.push([V(g.left[0], baseY), V(ridgeAt(0), apexY), V(g.right[0], baseY)]);
  tris.push([V(g.left[n - 1], baseY), V(ridgeAt(n - 1), apexY), V(g.right[n - 1], baseY)]);

  const arr: number[] = [];
  for (const t of tris) for (const v of t) arr.push(v[0], v[1], v[2]);
  return new Float32Array(arr);
}

/** Legacy: extrude berbasis footprint kotak. */
export function buildRoofPositions(args: {
  points: Point[];
  origin: Point;
  mPerPx: number;
  baseY: number;
  slopeDeg: number;
  kind: RoofKind;
}): Float32Array | null {
  return buildRoofMeshPositions({
    roof: {
      id: "tmp", levelId: "", points: args.points, kind: args.kind,
      baseHeightM: 0, slopeDeg: args.slopeDeg, createdAt: 0,
    },
    origin: args.origin,
    mPerPx: args.mPerPx,
    baseY: args.baseY,
  });
}
