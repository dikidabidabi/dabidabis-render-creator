// Modul Struktur — parametric structural grid shared across:
// - Sketch canvas (2D render + interaksi)
// - Model 3D (ekstrusi kolom)
// - Tabulasi & Presentasi (KPI total kolom + volume beton)
//
// Data model disimpan di field Sketch.structuralGrid. Geometri kolom dihitung
// dari array bentang per sumbu (meter) + origin (px world). Per-level override
// dipakai untuk meng-copy grid ke level lain & menonaktifkan node tertentu.

export type GridOverride = {
  disabledNodes?: string[];     // key "i,j"
  spansX?: number[];            // override bentang sumbu X
  spansY?: number[];            // override bentang sumbu Y
};

// Poligon perimeter untuk menyembunyikan kolom di area tertentu.
// Titik disimpan dalam METER relatif terhadap grid.origin agar konsisten
// di seluruh renderer (sketch / model 3D / presentasi).
export type ColumnClip = {
  id: string;
  pts: Array<{ x: number; y: number }>;
};

export type StructuralGrid = {
  enabled: boolean;
  origin: { x: number; y: number };     // titik (0,0) grid di koordinat kanvas (px world)
  rotation?: number;                     // derajat rotasi grid struktur (CW positif) — display & geometri kolom
  spansX: number[];                      // bentang antar as sumbu X (meter)
  spansY: number[];                      // bentang antar as sumbu Y (meter)
  colSizeCm: number;                     // ukuran kolom persegi (cm)
  labelOffsetX?: number;                 // offset penomoran sumbu X (0 → "1", 3 → "4")
  labelOffsetY?: number;                 // offset huruf sumbu Y (0 → "A", 3 → "D")
  fromLevelId?: string;                  // mulai berlaku dari level (inclusive)
  toLevelId?: string;                    // sampai dengan level (inclusive)
  perLevel?: Record<string, GridOverride>;
  columnClips?: ColumnClip[];            // poligon area yang menyembunyikan kolom
};

export const SPAN_PRESETS = [6, 7.2, 8, 9] as const;
export const COL_PRESETS = [40, 50, 60, 70, 80] as const;

export const DEFAULT_GRID: StructuralGrid = {
  enabled: false,
  origin: { x: 0, y: 0 },
  rotation: 0,
  spansX: [8, 8, 8],
  spansY: [8, 8],
  colSizeCm: 50,
};

export function normalizeGrid(g: any): StructuralGrid | undefined {
  if (!g || typeof g !== "object") return undefined;
  const arr = (v: any): number[] =>
    Array.isArray(v) ? v.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : [];
  const spansX = arr(g.spansX);
  const spansY = arr(g.spansY);
  const col = Number(g.colSizeCm);
  const perLevel: Record<string, GridOverride> = {};
  if (g.perLevel && typeof g.perLevel === "object") {
    for (const k of Object.keys(g.perLevel)) {
      const o = g.perLevel[k] ?? {};
      perLevel[k] = {
        disabledNodes: Array.isArray(o.disabledNodes)
          ? o.disabledNodes.filter((s: any) => typeof s === "string")
          : undefined,
        spansX: arr(o.spansX).length ? arr(o.spansX) : undefined,
        spansY: arr(o.spansY).length ? arr(o.spansY) : undefined,
      };
    }
  }
  const clips: ColumnClip[] = [];
  if (Array.isArray(g.columnClips)) {
    for (const c of g.columnClips) {
      if (!c || !Array.isArray(c.pts)) continue;
      const pts = c.pts
        .map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) }))
        .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length >= 3) {
        clips.push({
          id: typeof c.id === "string" && c.id ? c.id : `clip-${Math.random().toString(36).slice(2, 8)}`,
          pts,
        });
      }
    }
  }
  return {
    enabled: Boolean(g.enabled),
    origin: {
      x: Number.isFinite(Number(g.origin?.x)) ? Number(g.origin.x) : 0,
      y: Number.isFinite(Number(g.origin?.y)) ? Number(g.origin.y) : 0,
    },
    rotation: Number.isFinite(Number(g.rotation)) ? Number(g.rotation) : 0,
    spansX: spansX.length ? spansX : [...DEFAULT_GRID.spansX],
    spansY: spansY.length ? spansY : [...DEFAULT_GRID.spansY],
    colSizeCm: Number.isFinite(col) && col > 0 ? col : DEFAULT_GRID.colSizeCm,
    labelOffsetX: Number.isFinite(Number(g.labelOffsetX)) ? Math.max(0, Math.floor(Number(g.labelOffsetX))) : 0,
    labelOffsetY: Number.isFinite(Number(g.labelOffsetY)) ? Math.max(0, Math.floor(Number(g.labelOffsetY))) : 0,
    fromLevelId: typeof g.fromLevelId === "string" ? g.fromLevelId : undefined,
    toLevelId: typeof g.toLevelId === "string" ? g.toLevelId : undefined,
    perLevel: Object.keys(perLevel).length ? perLevel : undefined,
    columnClips: clips.length ? clips : undefined,
  };
}

// Kumulatif posisi as dalam meter, mulai 0.
export function axisPositions(spans: number[]): number[] {
  const out = [0];
  let acc = 0;
  for (const s of spans) {
    acc += s;
    out.push(acc);
  }
  return out;
}

// Label as: 1,2,3,... untuk X; A,B,...,Z,AA,AB,... untuk Y.
export function xAxisLabel(i: number): string {
  return String(i + 1);
}
export function yAxisLabel(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// Bentang efektif pada sebuah level (memperhitungkan override).
export function spansForLevel(
  grid: StructuralGrid,
  levelId: string | undefined,
): { spansX: number[]; spansY: number[] } {
  const ov = levelId ? grid.perLevel?.[levelId] : undefined;
  return {
    spansX: ov?.spansX && ov.spansX.length ? ov.spansX : grid.spansX,
    spansY: ov?.spansY && ov.spansY.length ? ov.spansY : grid.spansY,
  };
}

// Cek apakah node (i,j) aktif pada level tertentu (tidak di-disable).
export function isNodeActive(
  grid: StructuralGrid,
  levelId: string | undefined,
  i: number,
  j: number,
): boolean {
  if (!levelId) return true;
  const dis = grid.perLevel?.[levelId]?.disabledNodes;
  if (!dis || !dis.length) return true;
  return !dis.includes(`${i},${j}`);
}

// Ray-cast point in polygon (poligon koordinat meter relatif origin).
function pointInPoly(px: number, py: number, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Apakah kolom pada koordinat meter (mx,my) relatif grid.origin tersembunyi
// oleh salah satu clip polygon.
export function isColumnClipped(
  grid: StructuralGrid,
  mx: number,
  my: number,
): boolean {
  const clips = grid.columnClips;
  if (!clips || !clips.length) return false;
  for (const c of clips) {
    if (c.pts.length >= 3 && pointInPoly(mx, my, c.pts)) return true;
  }
  return false;
}

// Apakah kolom pada node (i,j) level tertentu ditampilkan (gabungan
// disabled-node + clip polygon).
export function isColumnVisible(
  grid: StructuralGrid,
  levelId: string | undefined,
  i: number,
  j: number,
  spansX?: number[],
  spansY?: number[],
): boolean {
  if (!isNodeActive(grid, levelId, i, j)) return false;
  const sx = spansX ?? grid.spansX;
  const sy = spansY ?? grid.spansY;
  const mx = axisPositions(sx)[i];
  const my = axisPositions(sy)[j];
  if (mx == null || my == null) return true;
  return !isColumnClipped(grid, mx, my);
}

// Apakah `levelMdpl` tercakup dalam range [fromLevelId..toLevelId] berdasarkan
// urutan MDPL ascending. Jika range tidak diset → berlaku untuk semua level
// di atas (atau sama dengan) MDPL 0 sebagai default praktis.
export function levelInRange(
  grid: StructuralGrid,
  level: { id: string; mdpl: number },
  allLevels: { id: string; mdpl: number }[],
): boolean {
  const sorted = [...allLevels].sort((a, b) => a.mdpl - b.mdpl);
  const idx = sorted.findIndex((l) => l.id === level.id);
  if (idx < 0) return false;
  const fromIdx = grid.fromLevelId ? sorted.findIndex((l) => l.id === grid.fromLevelId) : -1;
  const toIdx = grid.toLevelId ? sorted.findIndex((l) => l.id === grid.toLevelId) : -1;
  if (fromIdx < 0 && toIdx < 0) {
    // default: semua level dengan mdpl ≥ 0
    return level.mdpl >= -1e-6;
  }
  const lo = fromIdx >= 0 ? fromIdx : 0;
  const hi = toIdx >= 0 ? toIdx : sorted.length - 1;
  return idx >= Math.min(lo, hi) && idx <= Math.max(lo, hi);
}

// Hitung jumlah kolom efektif & volume beton (m³) untuk seluruh sketch.
// `tipicalCount` digandakan supaya lantai tipikal ikut terhitung.
export function computeStructuralStats(
  grid: StructuralGrid | undefined,
  levels: { id: string; mdpl: number; typicalCount?: number; typicalHeight?: number }[],
): { totalColumns: number; concreteVolumeM3: number } {
  if (!grid || !grid.enabled) return { totalColumns: 0, concreteVolumeM3: 0 };
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const colM = grid.colSizeCm / 100;
  const colArea = colM * colM;
  let cols = 0;
  let vol = 0;
  for (let i = 0; i < sorted.length; i++) {
    const lv = sorted[i];
    if (!levelInRange(grid, lv, sorted)) continue;
    const { spansX, spansY } = spansForLevel(grid, lv.id);
    const nx = spansX.length + 1;
    const ny = spansY.length + 1;
    let active = 0;
    for (let jj = 0; jj < ny; jj++) {
      for (let ii = 0; ii < nx; ii++) {
        if (isColumnVisible(grid, lv.id, ii, jj, spansX, spansY)) active++;
      }
    }
    const nodes = active;
    const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
    const h = Number.isFinite(Number(lv.typicalHeight)) && Number(lv.typicalHeight) > 0
      ? Number(lv.typicalHeight)
      : (sorted[i + 1] ? sorted[i + 1].mdpl - lv.mdpl : 3);
    const heightPerFloor = Math.max(0.1, h);
    cols += nodes * k;
    vol += nodes * k * colArea * heightPerFloor;
  }
  return { totalColumns: cols, concreteVolumeM3: vol };
}

// Kumpulkan semua grid yang aktif (enabled): primer + extras (paste grid).
export function collectGrids(
  primary: StructuralGrid | undefined,
  extras: StructuralGrid[] | undefined,
): StructuralGrid[] {
  const out: StructuralGrid[] = [];
  if (primary && primary.enabled) out.push(primary);
  if (Array.isArray(extras)) {
    for (const g of extras) {
      if (g && g.enabled) out.push(g);
    }
  }
  return out;
}

// Statistik gabungan untuk seluruh grid (primer + extras).
export function computeAllStructuralStats(
  primary: StructuralGrid | undefined,
  extras: StructuralGrid[] | undefined,
  levels: { id: string; mdpl: number; typicalCount?: number; typicalHeight?: number }[],
): { totalColumns: number; concreteVolumeM3: number } {
  const grids = collectGrids(primary, extras);
  let totalColumns = 0;
  let concreteVolumeM3 = 0;
  for (const g of grids) {
    const s = computeStructuralStats(g, levels);
    totalColumns += s.totalColumns;
    concreteVolumeM3 += s.concreteVolumeM3;
  }
  return { totalColumns, concreteVolumeM3 };
}

// Normalisasi array extras untuk persist/load.
export function normalizeGridExtras(arr: any): StructuralGrid[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const out: StructuralGrid[] = [];
  for (const g of arr) {
    const ng = normalizeGrid(g);
    if (ng) out.push(ng);
  }
  return out.length ? out : undefined;
}

