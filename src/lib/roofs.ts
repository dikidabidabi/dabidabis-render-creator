// Atap (roof) — entitas terpisah dari layer/lantai.
// Digambar dengan alat "kotak" pada halaman sketsa, lalu di-extrude otomatis
// pada halaman Model 3D (dan preview 3D masterplan).
//
// Dua jenis:
//   - pelana  : gable — bubungan memanjang penuh, dua ujung berupa dinding sopi-sopi
//   - limasan : hip   — bubungan lebih pendek, empat bidang miring
//
// Parameter:
//   - baseHeightM : tinggi tumpuan (eave) di atas MDPL level
//   - slopeDeg    : kemiringan bidang atap (derajat)
// Tinggi puncak = baseHeightM + (setengah bentang pendek) × tan(slope)

export type Point = { x: number; y: number };

export type RoofKind = "pelana" | "limasan";

export type Roof = {
  id: string;
  levelId: string;
  points: Point[];      // footprint (px sketsa), tidak ditutup
  kind: RoofKind;
  baseHeightM: number;  // tinggi tumpuan di atas MDPL level
  slopeDeg: number;     // 5..70
  createdAt: number;
};

export const DEFAULT_ROOF_HEIGHT_M = 3;
export const DEFAULT_ROOF_SLOPE_DEG = 30;

export function genRoofId(): string {
  return `RF${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeRoofs(raw: unknown, validLevelIds: Set<string>, fallback: string): Roof[] {
  if (!Array.isArray(raw)) return [];
  const out: Roof[] = [];
  for (const r of raw as any[]) {
    if (!r || typeof r !== "object") continue;
    if (!Array.isArray(r.points)) continue;
    const pts: Point[] = [];
    let ok = true;
    for (const p of r.points) {
      const x = Number(p?.x), y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) { ok = false; break; }
      pts.push({ x, y });
    }
    if (!ok || pts.length < 3) continue;
    const lid = typeof r.levelId === "string" && validLevelIds.has(r.levelId) ? r.levelId : fallback;
    const h = Number(r.baseHeightM);
    const s = Number(r.slopeDeg);
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : genRoofId(),
      levelId: lid,
      points: pts,
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
  // arah sisi terpanjang
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

function toWorld(f: RoofFrame, u: number, v: number): Point {
  return {
    x: f.center.x + f.eu.x * u + f.ev.x * v,
    y: f.center.y + f.eu.y * u + f.ev.y * v,
  };
}

/** Garis bantu untuk gambar plan 2D: bubungan + jurai. */
export function roofPlanLines(
  points: Point[],
  kind: RoofKind,
): { ridge: [Point, Point]; hips: [Point, Point][]; corners: Point[] } | null {
  const f = roofFrame(points);
  if (!f) return null;
  const rHalf = kind === "limasan" ? Math.max(0, f.halfU - f.halfV) : f.halfU;
  const r1 = toWorld(f, -rHalf, 0);
  const r2 = toWorld(f, rHalf, 0);
  const c = [
    toWorld(f, -f.halfU, -f.halfV),
    toWorld(f, f.halfU, -f.halfV),
    toWorld(f, f.halfU, f.halfV),
    toWorld(f, -f.halfU, f.halfV),
  ];
  const hips: [Point, Point][] = [
    [c[0], r1],
    [c[3], r1],
    [c[1], r2],
    [c[2], r2],
  ];
  return { ridge: [r1, r2], hips, corners: c };
}

/** Tinggi puncak atap (meter) relatif MDPL level. */
export function roofRidgeHeightM(points: Point[], slopeDeg: number, baseHeightM: number, mPerPx: number): number {
  const f = roofFrame(points);
  if (!f) return baseHeightM;
  const halfSpanM = f.halfV * mPerPx;
  return baseHeightM + halfSpanM * Math.tan((slopeDeg * Math.PI) / 180);
}

/**
 * Triangles (posisi XYZ, meter, Y ke atas) untuk mesh atap.
 * Konvensi sama dengan ExtrudedFloor: X = (px.x - origin.x) * mPerPx,
 * Z = (px.y - origin.y) * mPerPx.
 */
export function buildRoofPositions(args: {
  points: Point[];
  origin: Point;
  mPerPx: number;
  baseY: number;      // meter — elevasi tumpuan atap (MDPL level + baseHeightM)
  slopeDeg: number;
  kind: RoofKind;
}): Float32Array | null {
  const f = roofFrame(args.points);
  if (!f) return null;
  const { origin, mPerPx, baseY } = args;
  const rise = f.halfV * mPerPx * Math.tan((args.slopeDeg * Math.PI) / 180);
  const apexY = baseY + rise;
  const rHalf = args.kind === "limasan" ? Math.max(0, f.halfU - f.halfV) : f.halfU;

  const P = (u: number, v: number, y: number): [number, number, number] => {
    const w = toWorld(f, u, v);
    return [(w.x - origin.x) * mPerPx, y, (w.y - origin.y) * mPerPx];
  };

  const A = P(-f.halfU, -f.halfV, baseY);
  const B = P(f.halfU, -f.halfV, baseY);
  const C = P(f.halfU, f.halfV, baseY);
  const D = P(-f.halfU, f.halfV, baseY);
  const R1 = P(-rHalf, 0, apexY);
  const R2 = P(rHalf, 0, apexY);

  const tris: [number, number, number][][] = [
    // bidang miring sisi panjang
    [A, B, R2], [A, R2, R1],
    [C, D, R1], [C, R1, R2],
    // ujung: sopi-sopi (pelana) atau jurai (limasan)
    [B, C, R2],
    [D, A, R1],
    // dasar
    [A, B, C], [A, C, D],
  ];
  const arr: number[] = [];
  for (const t of tris) for (const v of t) arr.push(v[0], v[1], v[2]);
  return new Float32Array(arr);
}
