// Generator lot parkir otomatis (geometris, tanpa AI).
//
// Model area:
//   ParkingArea menyimpan polygon di KOORDINAT LOKAL mm-grid (sebelum rotasi
//   grid). Saat mm-grid diputar, area otomatis ikut karena world =
//   rotate(local, +mmGridRot). Skala tidak berubah karena tidak ada faktor
//   skala — koordinat lokal sudah dalam px.
//
// Packing:
//   Untuk tiap row (modul double/single 15.5m / 10.5m), kita hitung interval
//   valid sepanjang sumbu deret dengan mengurangi proyeksi obstacle. Stall
//   dipack flush dari ujung kiri interval — tidak ada skip 1 lot.

export type ParkingPoint = { x: number; y: number };

/** Jalur parkir (polyline) di koordinat lokal mm-grid. */
export type ParkingKind = "mobil" | "motor";

export type ParkingPath = {
  id: string;
  pointsLocal: ParkingPoint[]; // ≥ 2 titik
};

export type ParkingArea = {
  id: string;
  levelId?: string;
  /** Jenis kendaraan: "mobil" (default) atau "motor". */
  kind?: ParkingKind;
  /** Polygon area di koordinat lokal mm-grid (px). */
  pointsLocal: ParkingPoint[];
  /** Sumbu deret di koordinat lokal area-bbox: "x" / "y" / "auto". */
  orientation?: "auto" | "x" | "y";
  /** Rotasi tambahan sumbu stall relatif local-grid (radian). */
  stallRotation?: number;
  /** Kunci stall yang dimatikan manual (key = `row,col`). */
  disabled?: string[];
  /** Jalur parkir (polyline) — obstacle ber-buffer per sisi (kind-dependent). */
  paths?: ParkingPath[];
};

/** Lebar buffer jalur parkir per sisi untuk mobil (meter). */
export const PARKING_PATH_BUFFER_M = 1.75;
/** Lebar buffer jalur parkir per sisi untuk motor (meter). */
export const PARKING_PATH_BUFFER_M_MOTOR = 0.5;

export function genParkingPathId(): string {
  return `PP${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type ParkingStall = {
  id: string;
  row: number;
  col: number;
  /** Polygon 4 titik di koordinat dunia (px), urut CW. */
  poly: ParkingPoint[];
  center: ParkingPoint;
  angle: number;
  valid: boolean;
};

// Parameter baku (meter) — MOBIL
export const STALL_W = 2.4;
export const STALL_L = 5.0;
export const AISLE_W = 5.5;
export const MODULE_DOUBLE = STALL_L + AISLE_W + STALL_L; // 15.5 m
export const MODULE_SINGLE = STALL_L + AISLE_W;            // 10.5 m
export const STALL_AREA_M2 = STALL_W * STALL_L;            // 12.0 m²

// Parameter baku (meter) — MOTOR
export const STALL_W_MOTOR = 0.75;
export const STALL_L_MOTOR = 2.0;
export const AISLE_W_MOTOR = 1.5;
export const MODULE_DOUBLE_MOTOR = STALL_L_MOTOR + AISLE_W_MOTOR + STALL_L_MOTOR; // 5.5 m
export const MODULE_SINGLE_MOTOR = STALL_L_MOTOR + AISLE_W_MOTOR;                  // 3.5 m
export const STALL_AREA_M2_MOTOR = STALL_W_MOTOR * STALL_L_MOTOR;                  // 1.5 m²

export type ParkingSpecs = {
  STALL_W: number;
  STALL_L: number;
  AISLE_W: number;
  MODULE_DOUBLE: number;
  MODULE_SINGLE: number;
  STALL_AREA_M2: number;
  PATH_BUFFER_M: number;
};

export function specsFor(kind?: ParkingKind): ParkingSpecs {
  if (kind === "motor") {
    return {
      STALL_W: STALL_W_MOTOR,
      STALL_L: STALL_L_MOTOR,
      AISLE_W: AISLE_W_MOTOR,
      MODULE_DOUBLE: MODULE_DOUBLE_MOTOR,
      MODULE_SINGLE: MODULE_SINGLE_MOTOR,
      STALL_AREA_M2: STALL_AREA_M2_MOTOR,
      PATH_BUFFER_M: PARKING_PATH_BUFFER_M_MOTOR,
    };
  }
  return {
    STALL_W,
    STALL_L,
    AISLE_W,
    MODULE_DOUBLE,
    MODULE_SINGLE,
    STALL_AREA_M2,
    PATH_BUFFER_M: PARKING_PATH_BUFFER_M,
  };
}

export function genParkingId(): string {
  return `PK${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Apakah nama ruang mengizinkan lot parkir? */
export function isParkingName(name: string | undefined | null): boolean {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  return n.includes("parkir") || n.includes("parking");
}

// ============= Transform helpers (world ↔ local mm-grid) =============

export function worldFromLocal(p: ParkingPoint, mmRot: number): ParkingPoint {
  if (!mmRot) return { x: p.x, y: p.y };
  const c = Math.cos(mmRot), s = Math.sin(mmRot);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function localFromWorld(p: ParkingPoint, mmRot: number): ParkingPoint {
  if (!mmRot) return { x: p.x, y: p.y };
  const c = Math.cos(-mmRot), s = Math.sin(-mmRot);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function areaPolygonWorld(area: ParkingArea, mmRot: number): ParkingPoint[] {
  return area.pointsLocal.map((p) => worldFromLocal(p, mmRot));
}

export function areaBBoxLocal(area: ParkingArea): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of area.pointsLocal) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// ============= Normalisasi & migrasi =============

export function normalizeParkingArea(raw: any, mmRot = 0): ParkingArea | null {
  if (!raw || typeof raw !== "object") return null;
  let pointsLocal: ParkingPoint[] | null = null;
  if (Array.isArray(raw.pointsLocal) && raw.pointsLocal.length >= 3) {
    pointsLocal = [];
    for (const p of raw.pointsLocal) {
      const x = Number(p?.x), y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      pointsLocal.push({ x, y });
    }
  } else if (
    raw.center && Number.isFinite(Number(raw.halfW)) && Number.isFinite(Number(raw.halfH))
  ) {
    // Migrasi data lama: center + halfW/halfH + rotation (world) → pointsLocal.
    const cx = Number(raw.center.x), cy = Number(raw.center.y);
    const hw = Number(raw.halfW), hh = Number(raw.halfH);
    const rot = Number.isFinite(Number(raw.rotation)) ? Number(raw.rotation) : 0;
    if (![cx, cy, hw, hh].every(Number.isFinite)) return null;
    const c = Math.cos(rot), s = Math.sin(rot);
    const worldCorners = [
      { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
    ].map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
    pointsLocal = worldCorners.map((p) => localFromWorld(p, mmRot));
  }
  if (!pointsLocal || pointsLocal.length < 3) return null;
  const orientation: ParkingArea["orientation"] =
    raw.orientation === "x" || raw.orientation === "y" ? raw.orientation : "auto";
  const stallRotation = Number.isFinite(Number(raw.stallRotation)) ? Number(raw.stallRotation) : 0;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : genParkingId(),
    levelId: typeof raw.levelId === "string" ? raw.levelId : undefined,
    pointsLocal,
    orientation,
    stallRotation,
    disabled: Array.isArray(raw.disabled)
      ? raw.disabled.filter((s: any) => typeof s === "string")
      : undefined,
    paths: Array.isArray(raw.paths)
      ? raw.paths
          .map((p: any): ParkingPath | null => {
            if (!p || !Array.isArray(p.pointsLocal) || p.pointsLocal.length < 2) return null;
            const pts: ParkingPoint[] = [];
            for (const q of p.pointsLocal) {
              const x = Number(q?.x), y = Number(q?.y);
              if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
              pts.push({ x, y });
            }
            return {
              id: typeof p.id === "string" && p.id ? p.id : genParkingPathId(),
              pointsLocal: pts,
            };
          })
          .filter((p: ParkingPath | null): p is ParkingPath => !!p)
      : undefined,
  };
}

export function normalizeParkingAreas(arr: any, mmRot = 0): ParkingArea[] {
  if (!Array.isArray(arr)) return [];
  const out: ParkingArea[] = [];
  for (const r of arr) {
    const a = normalizeParkingArea(r, mmRot);
    if (a) out.push(a);
  }
  return out;
}

// ============= Geometri primitif =============

function pointInPoly(p: ParkingPoint, poly: ParkingPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > p.y) !== (yj > p.y) &&
        p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ============= Obstacle (di koordinat dunia) =============

export type ParkingObstacle =
  | { kind: "wall"; a: ParkingPoint; b: ParkingPoint; bufferPx: number }
  | { kind: "polygon"; poly: ParkingPoint[] };

/** Konversi jalur (polyline) area parkir → obstacle wall (dunia) dengan buffer
 *  PARKING_PATH_BUFFER_M di tiap sisi. */
export function parkingPathsToObstacles(
  areas: ParkingArea[],
  pxPerMeter: number,
  mmRot: number,
): ParkingObstacle[] {
  const out: ParkingObstacle[] = [];
  const buf = PARKING_PATH_BUFFER_M * pxPerMeter;
  for (const area of areas) {
    for (const path of area.paths ?? []) {
      const w = path.pointsLocal.map((p) => worldFromLocal(p, mmRot));
      for (let i = 0; i < w.length - 1; i++) {
        out.push({ kind: "wall", a: w[i], b: w[i + 1], bufferPx: buf });
      }
    }
  }
  return out;
}

/**
 * Konversi obstacle dunia → polygon di koordinat lokal mm-grid + sumbu stall.
 * Untuk wall, bangun thin-rect berlebar 2*buffer searah segmen.
 */
function obstacleToStallSpacePolys(
  obs: ParkingObstacle,
  mmRot: number,
  stallRot: number,
): ParkingPoint[] {
  // 1) world → local mm-grid
  // 2) local → stall-frame (rotasi -stallRot)
  const toStall = (p: ParkingPoint) => {
    const lp = localFromWorld(p, mmRot);
    if (!stallRot) return lp;
    const c = Math.cos(-stallRot), s = Math.sin(-stallRot);
    return { x: lp.x * c - lp.y * s, y: lp.x * s + lp.y * c };
  };
  if (obs.kind === "polygon") return obs.poly.map(toStall);
  // wall = thin rect
  const a = toStall(obs.a), b = toStall(obs.b);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [a, b, a, b];
  const nx = -dy / len, ny = dx / len;
  const buf = obs.bufferPx;
  return [
    { x: a.x + nx * buf, y: a.y + ny * buf },
    { x: b.x + nx * buf, y: b.y + ny * buf },
    { x: b.x - nx * buf, y: b.y - ny * buf },
    { x: a.x - nx * buf, y: a.y - ny * buf },
  ];
}

// ============= Interval subtraction =============

type Interval = [number, number];

function subtractIntervals(base: Interval, blocks: Interval[]): Interval[] {
  // Normalisasi & gabung blocks yang overlap
  const norm = blocks
    .map(([a, b]) => (a < b ? [a, b] : [b, a]) as Interval)
    .filter(([a, b]) => b > base[0] && a < base[1])
    .map(([a, b]) => [Math.max(a, base[0]), Math.min(b, base[1])] as Interval)
    .sort((p, q) => p[0] - q[0]);
  const merged: Interval[] = [];
  for (const iv of norm) {
    if (merged.length && iv[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
    } else merged.push([iv[0], iv[1]]);
  }
  const out: Interval[] = [];
  let cur = base[0];
  for (const [a, b] of merged) {
    if (a > cur) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < base[1]) out.push([cur, base[1]]);
  return out;
}

// ============= Generator stall =============

/**
 * @param area
 * @param pxPerMeter
 * @param mmGridRotRad rotasi mm-grid relatif dunia (radian)
 * @param obstacles    obstacle di koordinat dunia
 */
export function generateStalls(
  area: ParkingArea,
  pxPerMeter: number,
  mmGridRotRad: number,
  obstacles: ParkingObstacle[],
): ParkingStall[] {
  const stalls: ParkingStall[] = [];
  if (pxPerMeter <= 0 || area.pointsLocal.length < 3) return stalls;

  const stallRot = area.stallRotation ?? 0;

  // Pindah pointsLocal ke "stall-frame" (rotasi -stallRot di sekitar origin lokal).
  const toStall = (p: ParkingPoint) => {
    if (!stallRot) return { x: p.x, y: p.y };
    const c = Math.cos(-stallRot), s = Math.sin(-stallRot);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  };
  const fromStallToLocal = (p: ParkingPoint) => {
    if (!stallRot) return { x: p.x, y: p.y };
    const c = Math.cos(stallRot), s = Math.sin(stallRot);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  };
  const polyStall = area.pointsLocal.map(toStall);

  // BBox di stall-frame
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polyStall) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const widthPx = maxX - minX, heightPx = maxY - minY;
  const widthM = widthPx / pxPerMeter, heightM = heightPx / pxPerMeter;
  // Sumbu deret D vs lebar lajur A
  const alongAxis: "x" | "y" =
    area.orientation === "x" || area.orientation === "y"
      ? area.orientation
      : widthM >= heightM ? "x" : "y";
  const D = (alongAxis === "x" ? widthM : heightM);
  const A = (alongAxis === "x" ? heightM : widthM);
  if (D < STALL_W || A < STALL_L) return stalls;

  // Origin pojok bbox stall-frame: (minX, minY).
  // Konversi (d, a) meter dalam frame "alongAxis" ke koordinat (sx, sy) stall-frame px.
  const localOf = (d: number, a: number): ParkingPoint => {
    if (alongAxis === "x") return { x: minX + d * pxPerMeter, y: minY + a * pxPerMeter };
    return { x: minX + a * pxPerMeter, y: minY + d * pxPerMeter };
  };

  // Susun baris seperti sebelumnya: modul double 15.5m + sisa single/single-row.
  type Row = { offset: number; faceSign: 1 | -1 };
  const rows: Row[] = [];
  let used = 0;
  while (A - used >= MODULE_DOUBLE - 1e-6) {
    rows.push({ offset: used + STALL_L / 2, faceSign: 1 });
    rows.push({ offset: used + STALL_L + AISLE_W + STALL_L / 2, faceSign: -1 });
    used += MODULE_DOUBLE;
  }
  if (A - used >= MODULE_SINGLE - 1e-6) {
    rows.push({ offset: used + STALL_L / 2, faceSign: 1 });
    used += MODULE_SINGLE;
  } else if (A - used >= STALL_L - 1e-6) {
    rows.push({ offset: used + STALL_L / 2, faceSign: -1 });
    used += STALL_L;
  }
  if (rows.length === 0) return stalls;

  // Konversi obstacle ke stall-frame polygon (sekali saja).
  const obsPolys: ParkingPoint[][] = obstacles.map((o) =>
    obstacleToStallSpacePolys(o, mmGridRotRad, stallRot),
  );

  // Untuk tiap row, hitung interval valid sepanjang sumbu D (stall flush).
  const disabled = new Set(area.disabled ?? []);

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    // Strip stall ini di stall-frame px:
    //   alongAxis = "x" → strip y ∈ [minY + (row.offset - L/2)*ppm, minY + (row.offset + L/2)*ppm]
    //   alongAxis = "y" → strip x ∈ [minX + (row.offset - L/2)*ppm, minX + (row.offset + L/2)*ppm]
    const stripA0 = (row.offset - STALL_L / 2) * pxPerMeter;
    const stripA1 = (row.offset + STALL_L / 2) * pxPerMeter;
    const stripStart = alongAxis === "x" ? minY + stripA0 : minX + stripA0;
    const stripEnd   = alongAxis === "x" ? minY + stripA1 : minX + stripA1;

    // Proyeksi obstacle ke sumbu D, hanya jika strip overlap dengan obstacle.
    const blocks: Interval[] = [];
    for (const poly of obsPolys) {
      let oMinA = Infinity, oMaxA = -Infinity;
      let oMinD = Infinity, oMaxD = -Infinity;
      for (const p of poly) {
        const aVal = alongAxis === "x" ? p.y : p.x;
        const dVal = alongAxis === "x" ? p.x : p.y;
        if (aVal < oMinA) oMinA = aVal; if (aVal > oMaxA) oMaxA = aVal;
        if (dVal < oMinD) oMinD = dVal; if (dVal > oMaxD) oMaxD = dVal;
      }
      // Overlap strip pada sumbu A?
      if (oMaxA <= stripStart || oMinA >= stripEnd) continue;
      // Konversi ke koordinat meter sumbu D, asal dari (minD-pojok bbox).
      const dOrig = alongAxis === "x" ? minX : minY;
      const d1m = (oMinD - dOrig) / pxPerMeter;
      const d2m = (oMaxD - dOrig) / pxPerMeter;
      // Blocked s-interval untuk stall left-edge = [d1m - STALL_W, d2m]
      blocks.push([d1m - STALL_W, d2m]);
    }
    // Tambah constraint area-polygon non-rect: kalau polygon bukan bbox, kita
    // belum subtract; tapi stall yang keluar polygon akan dibuang via containment.
    const sRange: Interval = [0, D - STALL_W];
    if (sRange[1] <= sRange[0]) continue;
    const validIntervals = subtractIntervals(sRange, blocks);

    let ci = 0;
    for (const [a, b] of validIntervals) {
      const span = b - a;
      if (span < 0) continue;
      const n = Math.floor(span / STALL_W) + 1;
      for (let k = 0; k < n; k++) {
        const s = a + k * STALL_W;
        if (s + STALL_W > D + 1e-6) break;
        const key = `${ri},${ci}`;
        const d0 = s, d1 = s + STALL_W;
        const a0 = row.offset - STALL_L / 2;
        const a1 = row.offset + STALL_L / 2;
        // 4 titik di stall-frame
        const p1s = localOf(d0, a0);
        const p2s = localOf(d1, a0);
        const p3s = localOf(d1, a1);
        const p4s = localOf(d0, a1);
        // Cek containment polygon area (semua corner harus di dalam).
        const allIn =
          pointInPoly(p1s, polyStall) && pointInPoly(p2s, polyStall) &&
          pointInPoly(p3s, polyStall) && pointInPoly(p4s, polyStall);
        if (!allIn) { ci++; continue; }
        const isDisabled = disabled.has(key);
        // stall-frame → local mm-grid → world
        const cornersLocal = [p1s, p2s, p3s, p4s].map(fromStallToLocal);
        const cornersWorld = cornersLocal.map((p) => worldFromLocal(p, mmGridRotRad));
        const cx = (cornersWorld[0].x + cornersWorld[2].x) / 2;
        const cy = (cornersWorld[0].y + cornersWorld[2].y) / 2;
        const totalRot = mmGridRotRad + stallRot;
        const faceAngle = alongAxis === "x"
          ? totalRot + (row.faceSign > 0 ? Math.PI / 2 : -Math.PI / 2)
          : totalRot + (row.faceSign > 0 ? 0 : Math.PI);
        stalls.push({
          id: `${area.id}-${ri}-${ci}`,
          row: ri,
          col: ci,
          poly: cornersWorld,
          center: { x: cx, y: cy },
          angle: faceAngle,
          valid: !isDisabled,
        });
        ci++;
      }
    }
  }
  return stalls;
}

/** Statistik parkir. */
export function computeParkingStats(
  areas: ParkingArea[],
  pxPerMeter: number,
  mmGridRotRad: number,
  obstaclesByLevel: (levelId: string | undefined) => ParkingObstacle[],
): { totalStalls: number; areaM2: number; efficiencyPct: number } {
  let totalStalls = 0;
  let areaM2 = 0;
  for (const area of areas) {
    const stalls = generateStalls(area, pxPerMeter, mmGridRotRad, obstaclesByLevel(area.levelId));
    for (const s of stalls) if (s.valid) totalStalls++;
    // luas polygon (shoelace) di local-px → m²
    const pts = area.pointsLocal;
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      acc += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    const areaPx = Math.abs(acc) / 2;
    areaM2 += areaPx / (pxPerMeter * pxPerMeter);
  }
  const efficiencyPct = areaM2 > 0 ? (totalStalls * STALL_AREA_M2 * 100) / areaM2 : 0;
  return { totalStalls, areaM2, efficiencyPct };
}
