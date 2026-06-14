// Generator lot parkir otomatis (geometris, tanpa AI).
//
// Data model:
//   ParkingArea = bounding box yang ditarik pengguna, disimpan dalam koordinat
//   dunia (px) + rotasi (radian) yang ter-snap ke grid struktural aktif.
//
// Geometri stall dihitung on-the-fly dari area + obstacles (dinding & kolom)
// agar tidak menyimpan state turunan yang mudah basi.

export type ParkingPoint = { x: number; y: number };

export type ParkingArea = {
  id: string;
  levelId?: string;
  /** Titik tengah bbox di koordinat dunia (px). */
  center: ParkingPoint;
  /** Setengah-lebar & setengah-tinggi bbox dalam koordinat lokal (px). */
  halfW: number;
  halfH: number;
  /** Rotasi bbox terhadap sumbu dunia (radian). Snap ke grid struktural. */
  rotation: number;
  /** Sumbu deret stall di koordinat lokal area: "x" = sepanjang lebar bbox,
   *  "y" = sepanjang tinggi bbox. Default "auto" → pilih sisi terpanjang. */
  orientation?: "auto" | "x" | "y";
  /** Kunci stall yang dimatikan manual (key = `row,col`). */
  disabled?: string[];
};

export type ParkingStall = {
  id: string;
  row: number;
  col: number;
  /** Polygon 4 titik di koordinat dunia (px), urut CW. */
  poly: ParkingPoint[];
  /** Center stall (px). */
  center: ParkingPoint;
  /** Sudut hadap stall (radian). */
  angle: number;
  valid: boolean;
};

// Parameter baku (meter)
export const STALL_W = 2.5;
export const STALL_L = 5.0;
export const AISLE_W = 5.5;
export const MODULE_DOUBLE = STALL_L + AISLE_W + STALL_L; // 15.5 m
export const MODULE_SINGLE = STALL_L + AISLE_W;            // 10.5 m
export const STALL_AREA_M2 = STALL_W * STALL_L;            // 12.5 m²

export function genParkingId(): string {
  return `PK${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeParkingArea(raw: any): ParkingArea | null {
  if (!raw || typeof raw !== "object") return null;
  const cx = Number(raw?.center?.x);
  const cy = Number(raw?.center?.y);
  const hw = Number(raw?.halfW);
  const hh = Number(raw?.halfH);
  const rot = Number(raw?.rotation);
  if (![cx, cy, hw, hh].every(Number.isFinite)) return null;
  if (hw <= 0 || hh <= 0) return null;
  const orientation: ParkingArea["orientation"] =
    raw.orientation === "x" || raw.orientation === "y" ? raw.orientation : "auto";
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : genParkingId(),
    levelId: typeof raw.levelId === "string" ? raw.levelId : undefined,
    center: { x: cx, y: cy },
    halfW: hw,
    halfH: hh,
    rotation: Number.isFinite(rot) ? rot : 0,
    orientation,
    disabled: Array.isArray(raw.disabled)
      ? raw.disabled.filter((s: any) => typeof s === "string")
      : undefined,
  };
}

export function normalizeParkingAreas(arr: any): ParkingArea[] {
  if (!Array.isArray(arr)) return [];
  const out: ParkingArea[] = [];
  for (const r of arr) {
    const a = normalizeParkingArea(r);
    if (a) out.push(a);
  }
  return out;
}

// ============= Geometri primitif =============

function rotate(p: ParkingPoint, ang: number): ParkingPoint {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function add(a: ParkingPoint, b: ParkingPoint): ParkingPoint {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Jarak titik ke segmen (px). */
function pointToSegmentDist(p: ParkingPoint, a: ParkingPoint, b: ParkingPoint): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function segmentsIntersect(
  a: ParkingPoint, b: ParkingPoint,
  c: ParkingPoint, d: ParkingPoint,
): boolean {
  const o = (p: ParkingPoint, q: ParkingPoint, r: ParkingPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
         ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

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

export type ParkingObstacle =
  | { kind: "wall"; a: ParkingPoint; b: ParkingPoint; bufferPx: number }
  | { kind: "polygon"; poly: ParkingPoint[] };

/** Apakah polygon stall (4 titik) berbenturan dengan obstacle. */
function stallHitsObstacle(stall: ParkingPoint[], obs: ParkingObstacle): boolean {
  if (obs.kind === "wall") {
    // Jika ada titik segmen di dalam polygon stall → tabrak.
    if (pointInPoly(obs.a, stall) || pointInPoly(obs.b, stall)) return true;
    // Cek jarak setiap sisi stall ke segmen dinding (buffer).
    for (let i = 0; i < 4; i++) {
      const p1 = stall[i], p2 = stall[(i + 1) % 4];
      // Segmen vs segmen
      if (segmentsIntersect(p1, p2, obs.a, obs.b)) return true;
      // Buffer dinding
      if (pointToSegmentDist(p1, obs.a, obs.b) < obs.bufferPx) return true;
    }
    // Jangkau buffer dari titik dinding ke sisi stall
    for (let i = 0; i < 4; i++) {
      const p1 = stall[i], p2 = stall[(i + 1) % 4];
      if (pointToSegmentDist(obs.a, p1, p2) < obs.bufferPx) return true;
      if (pointToSegmentDist(obs.b, p1, p2) < obs.bufferPx) return true;
    }
    return false;
  }
  // polygon obstacle (kolom kotak)
  const op = obs.poly;
  for (const p of op) if (pointInPoly(p, stall)) return true;
  for (const p of stall) if (pointInPoly(p, op)) return true;
  for (let i = 0; i < 4; i++) {
    const s1 = stall[i], s2 = stall[(i + 1) % 4];
    for (let j = 0; j < op.length; j++) {
      const o1 = op[j], o2 = op[(j + 1) % op.length];
      if (segmentsIntersect(s1, s2, o1, o2)) return true;
    }
  }
  return false;
}

// ============= Generator stall =============

/**
 * Hasilkan deret stall untuk satu area.
 * @param pxPerMeter   skala dunia (px per meter)
 * @param obstacles    daftar penghalang di koordinat dunia
 */
export function generateStalls(
  area: ParkingArea,
  pxPerMeter: number,
  obstacles: ParkingObstacle[],
): ParkingStall[] {
  const stalls: ParkingStall[] = [];
  if (pxPerMeter <= 0) return stalls;
  const halfW = area.halfW;
  const halfH = area.halfH;
  const widthM = (halfW * 2) / pxPerMeter;
  const heightM = (halfH * 2) / pxPerMeter;

  // Pilih sumbu deret (D = sepanjang deret/stall-side, A = lebar lajur).
  let alongAxis: "x" | "y" =
    area.orientation === "x" || area.orientation === "y"
      ? area.orientation
      : widthM >= heightM
      ? "x"
      : "y";

  const D = alongAxis === "x" ? widthM : heightM;   // panjang deret
  const A = alongAxis === "x" ? heightM : widthM;   // lebar lajur
  if (D < STALL_W || A < STALL_L) return stalls;

  // Bagi lebar A → modul double (15.5 m), sisa single (≥5 m) sebagai baris tanpa aisle.
  // Susunan baris (offset dari -A/2..+A/2 di sumbu tegak lurus deret).
  type Row = { offset: number; faceSign: 1 | -1 };
  const rows: Row[] = [];
  let used = 0;
  // Awali dari tepi
  while (A - used >= MODULE_DOUBLE - 1e-6) {
    // baris pertama: center stall pada used + STALL_L/2, hadap aisle (+)
    rows.push({ offset: used + STALL_L / 2, faceSign: 1 });
    rows.push({ offset: used + STALL_L + AISLE_W + STALL_L / 2, faceSign: -1 });
    used += MODULE_DOUBLE;
  }
  // Sisa: bisa muat satu modul single-loaded (baris + aisle) atau hanya satu baris stall.
  if (A - used >= MODULE_SINGLE - 1e-6) {
    rows.push({ offset: used + STALL_L / 2, faceSign: 1 });
    used += MODULE_SINGLE;
  } else if (A - used >= STALL_L - 1e-6) {
    rows.push({ offset: used + STALL_L / 2, faceSign: -1 });
    used += STALL_L;
  }
  if (rows.length === 0) return stalls;

  // Hitung jumlah stall sepanjang deret + buffer simetris.
  const nStalls = Math.floor(D / STALL_W);
  if (nStalls <= 0) return stalls;
  const bufferD = (D - nStalls * STALL_W) / 2;

  // Konversi koordinat lokal-area (meter, origin = pojok kiri-atas A/D)
  // ke world (px) via rotasi area + translasi center.
  const ang = area.rotation;
  const localToWorldM = (mx: number, my: number): ParkingPoint => {
    // local meter → local px (origin = center, sumbu x = "alongAxis", y = tegak lurus)
    let lx: number, ly: number;
    if (alongAxis === "x") {
      lx = (mx - D / 2) * pxPerMeter;
      ly = (my - A / 2) * pxPerMeter;
    } else {
      // alongAxis = y → meter ke arah halfH
      lx = (my - A / 2) * pxPerMeter;
      ly = (mx - D / 2) * pxPerMeter;
    }
    const r = rotate({ x: lx, y: ly }, ang);
    return add(r, area.center);
  };

  const disabled = new Set(area.disabled ?? []);

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    for (let ci = 0; ci < nStalls; ci++) {
      const key = `${ri},${ci}`;
      if (disabled.has(key)) continue;
      // Rect dalam meter (alongAxis = sepanjang D, perp = A)
      const d0 = bufferD + ci * STALL_W;
      const d1 = d0 + STALL_W;
      const a0 = row.offset - STALL_L / 2;
      const a1 = row.offset + STALL_L / 2;
      const p1 = localToWorldM(d0, a0);
      const p2 = localToWorldM(d1, a0);
      const p3 = localToWorldM(d1, a1);
      const p4 = localToWorldM(d0, a1);
      const poly = [p1, p2, p3, p4];
      const cx = (p1.x + p3.x) / 2;
      const cy = (p1.y + p3.y) / 2;
      // Sudut hadap stall (untuk mark hood opsional)
      const faceAngle = alongAxis === "x"
        ? ang + (row.faceSign > 0 ? Math.PI / 2 : -Math.PI / 2)
        : ang + (row.faceSign > 0 ? 0 : Math.PI);
      let valid = true;
      for (const obs of obstacles) {
        if (stallHitsObstacle(poly, obs)) { valid = false; break; }
      }
      stalls.push({
        id: `${area.id}-${ri}-${ci}`,
        row: ri,
        col: ci,
        poly,
        center: { x: cx, y: cy },
        angle: faceAngle,
        valid,
      });
    }
  }
  return stalls;
}

/** Akumulasi statistik parkir untuk satu set area (satu level / seluruh proyek). */
export function computeParkingStats(
  areas: ParkingArea[],
  pxPerMeter: number,
  obstaclesByLevel: (levelId: string | undefined) => ParkingObstacle[],
): { totalStalls: number; areaM2: number; efficiencyPct: number } {
  let totalStalls = 0;
  let areaM2 = 0;
  for (const area of areas) {
    const stalls = generateStalls(area, pxPerMeter, obstaclesByLevel(area.levelId));
    for (const s of stalls) if (s.valid) totalStalls++;
    const w = (area.halfW * 2) / pxPerMeter;
    const h = (area.halfH * 2) / pxPerMeter;
    areaM2 += w * h;
  }
  const efficiencyPct = areaM2 > 0 ? (totalStalls * STALL_AREA_M2 * 100) / areaM2 : 0;
  return { totalStalls, areaM2, efficiencyPct };
}
