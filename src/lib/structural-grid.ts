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
  colSizeCm: number;                     // sisi kolom kotak / diameter kolom lingkaran (cm)
  colShape?: ColumnShape;                // bentuk kolom; bawaan "square" (kotak)
  labelOffsetX?: number;                 // offset penomoran sumbu X (0 → "1", 3 → "4")
  labelOffsetY?: number;                 // offset huruf sumbu Y (0 → "A", 3 → "D")
  // Visibilitas buble ujung — true = sembunyikan buble di ujung tsb.
  hideBubbleStartX?: boolean;            // sembunyikan buble X di ujung as pertama
  hideBubbleEndX?: boolean;              // sembunyikan buble X di ujung as terakhir
  hideBubbleStartY?: boolean;            // sembunyikan buble Y di ujung as pertama
  hideBubbleEndY?: boolean;              // sembunyikan buble Y di ujung as terakhir
  // Grid hasil "Jadikan Grid" dari satu garis — hanya satu sumbu (X), tanpa kolom.
  lineOnly?: boolean;
  // Garis-garis tambahan yang "tergabung" ke dalam grid ini (hasil mode
  // "Jadikan Grid"). Tiap garis punya origin & rotasi sendiri di koordinat
  // dunia (px), panjangnya dalam meter. Label buble melanjutkan serial X
  // grid induk (mulai dari spansX.length + 1).
  extraLines?: Array<{
    id: string;
    origin: { x: number; y: number };
    rotation: number;
    lengthM: number;
    // Garis bersambung hasil "Jadikan Grid" (≥3 titik, px dunia). Bila ada,
    // seluruh rangkaian dianggap satu nomor grid; buble di ujung awal & akhir.
    points?: Array<{ x: number; y: number }>;
    hideStart?: boolean;
    hideEnd?: boolean;
  }>;
  // Kolom hasil "Insert Kolom" pada persilangan garis grid. Titik dalam METER
  // relatif grid.origin di frame lokal grid (sama seperti columnClips).
  insertedColumns?: InsertedColumn[];
  fromLevelId?: string;                  // mulai berlaku dari level (inclusive)
  toLevelId?: string;                    // sampai dengan level (inclusive)
  perLevel?: Record<string, GridOverride>;
  columnClips?: ColumnClip[];            // poligon area yang menyembunyikan kolom
  // Grid lain yang sudah di-"Merge Grid" ke grid ini. Tiap anak tetap utuh
  // (bentang, kolom, clip, label) dalam koordinat dunia dan ikut bergeser /
  // berotasi bersama grid induk.
  merged?: StructuralGrid[];
};


export type ColumnShape = "square" | "circle";
export type InsertedColumn = { id: string; x: number; y: number };

export function isCircularColumn(grid: Pick<StructuralGrid, "colShape">): boolean {
  return grid.colShape === "circle";
}

// Luas penampang kolom (m²): kotak = sisi², lingkaran = π·(diameter/2)².
export function columnCrossSectionAreaM2(grid: Pick<StructuralGrid, "colSizeCm" | "colShape">): number {
  const sizeM = grid.colSizeCm / 100;
  return isCircularColumn(grid) ? Math.PI * (sizeM / 2) ** 2 : sizeM * sizeM;
}

// Poligon tapak kolom di koordinat dunia. `sizePx` = sisi kotak atau diameter
// lingkaran; lingkaran didekati 24 sisi untuk hitungan geometri/obstacle.
export function columnFootprintPolygon(
  center: { x: number; y: number },
  sizePx: number,
  rotationRad: number,
  shape: ColumnShape | undefined,
): Array<{ x: number; y: number }> {
  const half = sizePx / 2;
  if (shape === "circle") {
    const n = 24;
    return Array.from({ length: n }, (_, k) => {
      const a = rotationRad + (k / n) * Math.PI * 2;
      return { x: center.x + half * Math.cos(a), y: center.y + half * Math.sin(a) };
    });
  }
  const cs = Math.cos(rotationRad), sn = Math.sin(rotationRad);
  return [
    { x: -half, y: -half }, { x: half, y: -half },
    { x: half, y: half }, { x: -half, y: half },
  ].map((c) => ({ x: center.x + c.x * cs - c.y * sn, y: center.y + c.x * sn + c.y * cs }));
}

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
    spansY: spansY.length ? spansY : (g.lineOnly ? [] : [...DEFAULT_GRID.spansY]),
    colSizeCm: Number.isFinite(col) && col > 0 ? col : DEFAULT_GRID.colSizeCm,
    colShape: g.colShape === "circle" ? "circle" : "square",
    labelOffsetX: Number.isFinite(Number(g.labelOffsetX)) ? Math.max(0, Math.floor(Number(g.labelOffsetX))) : 0,
    labelOffsetY: Number.isFinite(Number(g.labelOffsetY)) ? Math.max(0, Math.floor(Number(g.labelOffsetY))) : 0,
    hideBubbleStartX: Boolean(g.hideBubbleStartX),
    hideBubbleEndX: Boolean(g.hideBubbleEndX),
    hideBubbleStartY: Boolean(g.hideBubbleStartY),
    hideBubbleEndY: Boolean(g.hideBubbleEndY),
    lineOnly: Boolean(g.lineOnly),
    extraLines: Array.isArray(g.extraLines)
      ? g.extraLines
          .map((l: any, idx: number) => {
            const ox = Number(l?.origin?.x);
            const oy = Number(l?.origin?.y);
            const rot = Number(l?.rotation);
            const len = Number(l?.lengthM);
            if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(len) || len <= 0) return null;
            return {
              id: typeof l.id === "string" && l.id ? l.id : `xl-${idx}-${Math.random().toString(36).slice(2, 6)}`,
              origin: { x: ox, y: oy },
              rotation: Number.isFinite(rot) ? rot : 0,
              lengthM: len,
              ...(Array.isArray(l.points)
                ? (() => {
                    const pts = l.points
                      .map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) }))
                      .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
                    return pts.length >= 3 ? { points: pts } : {};
                  })()
                : {}),
              hideStart: Boolean(l.hideStart),
              hideEnd: Boolean(l.hideEnd),
            };
          })
          .filter(Boolean) as StructuralGrid["extraLines"]
      : undefined,
    fromLevelId: typeof g.fromLevelId === "string" ? g.fromLevelId : undefined,
    toLevelId: typeof g.toLevelId === "string" ? g.toLevelId : undefined,
    perLevel: Object.keys(perLevel).length ? perLevel : undefined,
    columnClips: clips.length ? clips : undefined,
    insertedColumns: normalizeInsertedColumns(g.insertedColumns),
    merged: normalizeMerged(g.merged),
  };
}

function normalizeInsertedColumns(arr: any): InsertedColumn[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const out: InsertedColumn[] = [];
  arr.forEach((c: any, idx: number) => {
    const x = Number(c?.x), y = Number(c?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    out.push({ id: typeof c.id === "string" && c.id ? c.id : `ic-${idx}-${Math.random().toString(36).slice(2, 6)}`, x, y });
  });
  return out.length ? out : undefined;
}

function normalizeMerged(arr: any): StructuralGrid[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const out: StructuralGrid[] = [];
  for (const raw of arr) {
    const child = normalizeGrid(raw);
    if (!child) continue;
    const { merged: nested, ...base } = child;
    out.push({ ...base, enabled: true });
    for (const n of nested ?? []) out.push({ ...n, enabled: true });
  }
  return out.length ? out : undefined;
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
// Label dengan offset (sesuai labelOffsetX/Y pada grid).
export function xAxisLabelAt(i: number, offset: number = 0): string {
  return xAxisLabel(i + Math.max(0, offset | 0));
}
export function yAxisLabelAt(i: number, offset: number = 0): string {
  return yAxisLabel(i + Math.max(0, offset | 0));
}
// Parser kebalikan label.
export function parseXAxisLabel(s: string): number | null {
  const n = parseInt(String(s).trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n - 1 : null;
}
export function parseYAxisLabel(s: string): number | null {
  const str = String(s).trim().toUpperCase();
  if (!str || !/^[A-Z]+$/.test(str)) return null;
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    n = n * 26 + (str.charCodeAt(i) - 64);
  }
  return n - 1;
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

// Seluruh kolom yang tampil pada level (node grid aktif + kolom sisipan),
// dalam METER di frame lokal grid relatif origin.
export type GridColumnPoint = { key: string; mx: number; my: number; i?: number; j?: number; inserted?: boolean };
export function gridColumnPoints(
  grid: StructuralGrid,
  levelId: string | undefined,
  spansX?: number[],
  spansY?: number[],
): GridColumnPoint[] {
  const out: GridColumnPoint[] = [];
  if (!grid.lineOnly) {
    const sx = spansX ?? spansForLevel(grid, levelId).spansX;
    const sy = spansY ?? spansForLevel(grid, levelId).spansY;
    const px = axisPositions(sx);
    const py = axisPositions(sy);
    for (let j = 0; j < py.length; j++) {
      for (let i = 0; i < px.length; i++) {
        if (isColumnVisible(grid, levelId, i, j, sx, sy)) out.push({ key: `${i},${j}`, mx: px[i], my: py[j], i, j });
      }
    }
  }
  for (const c of grid.insertedColumns ?? []) out.push({ key: `ins-${c.id}`, mx: c.x, my: c.y, inserted: true });
  return out;
}

// Titik lokal grid (meter) → koordinat dunia (px).
export function gridLocalToWorld(grid: StructuralGrid, mx: number, my: number, ppm: number): { x: number; y: number } {
  const r = ((Number(grid.rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: grid.origin.x + (mx * c - my * s) * ppm, y: grid.origin.y + (mx * s + my * c) * ppm };
}

export function gridWorldToLocal(grid: StructuralGrid, p: { x: number; y: number }, ppm: number): { x: number; y: number } {
  const r = ((Number(grid.rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const dx = p.x - grid.origin.x, dy = p.y - grid.origin.y;
  return { x: (dx * c + dy * s) / ppm, y: (-dx * s + dy * c) / ppm };
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
  const colArea = columnCrossSectionAreaM2(grid);
  let cols = 0;
  let vol = 0;
  for (let i = 0; i < sorted.length; i++) {
    const lv = sorted[i];
    if (!levelInRange(grid, lv, sorted)) continue;
    const { spansX, spansY } = spansForLevel(grid, lv.id);
    const nodes = gridColumnPoints(grid, lv.id, spansX, spansY).length;
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
  const push = (g: StructuralGrid | undefined) => {
    if (!g || !g.enabled) return;
    out.push(g);
    for (const child of g.merged ?? []) out.push({ ...child, enabled: true, merged: undefined });
  };
  push(primary);
  if (Array.isArray(extras)) for (const g of extras) push(g);
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


// ----- Merge Grid -----
// Segmen as grid (koordinat dunia px) dalam format extraLines.
export type GridAxisSegment = {
  origin: { x: number; y: number };
  rotation: number;
  lengthM: number;
  hideStart?: boolean;
  hideEnd?: boolean;
};

export function gridAxisSegments(g: StructuralGrid, ppm: number): GridAxisSegment[] {
  const r = ((g.rotation ?? 0) * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const toWorld = (lx: number, ly: number) => ({
    x: g.origin.x + lx * c - ly * s,
    y: g.origin.y + lx * s + ly * c,
  });
  const posX = axisPositions(g.spansX);
  const posY = axisPositions(g.spansY);
  const totX = posX[posX.length - 1] ?? 0;
  const totY = posY[posY.length - 1] ?? 0;
  const out: GridAxisSegment[] = [];
  const rot = g.rotation ?? 0;
  if (g.lineOnly) {
    if (totX > 0) out.push({ origin: toWorld(0, 0), rotation: rot, lengthM: totX, hideStart: g.hideBubbleStartX, hideEnd: g.hideBubbleEndX });
  } else {
    if (totY > 0) for (const x of posX) out.push({ origin: toWorld(x * ppm, 0), rotation: rot + 90, lengthM: totY, hideStart: g.hideBubbleStartX, hideEnd: g.hideBubbleEndX });
    if (totX > 0) for (const y of posY) out.push({ origin: toWorld(0, y * ppm), rotation: rot, lengthM: totX, hideStart: g.hideBubbleStartY, hideEnd: g.hideBubbleEndY });
  }
  for (const el of g.extraLines ?? []) {
    if (!el.points || el.points.length < 3) {
      out.push({ origin: { ...el.origin }, rotation: el.rotation, lengthM: el.lengthM, hideStart: el.hideStart, hideEnd: el.hideEnd });
      continue;
    }
    const pts = el.points;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      out.push({
        origin: { ...a },
        rotation: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
        lengthM: len / ppm,
        hideStart: k === 1 ? el.hideStart : true,
        hideEnd: k === pts.length - 1 ? el.hideEnd : true,
      });
    }
  }
  return out;
}

type ExtraLine = NonNullable<StructuralGrid["extraLines"]>[number];

// Titik-titik garis tambahan di koordinat dunia (px): lurus = 2 titik,
// garis bersambung = seluruh titik sambungan.
export function extraLinePath(el: ExtraLine, ppm: number): Array<{ x: number; y: number }> {
  if (el.points && el.points.length >= 3) return el.points.map((p) => ({ ...p }));
  const r = (el.rotation * Math.PI) / 180;
  const len = el.lengthM * ppm;
  return [{ ...el.origin }, { x: el.origin.x + Math.cos(r) * len, y: el.origin.y + Math.sin(r) * len }];
}

// ----- Jadikan Grid: garis bersambung -----
// Mulai dari garis terpilih, sambungkan garis lain yang ujungnya bertemu
// (toleransi `tolPx`) dan berbelok 0° hingga < 90° dari arah garis
// sebelumnya. Hasilnya satu rangkaian titik berurutan (satu nomor grid).
type Pt = { x: number; y: number };
export function chainGridLines(
  segs: ReadonlyArray<{ a: Pt; b: Pt } | null | undefined>,
  startIdx: number,
  tolPx: number,
): { points: Pt[]; indices: number[] } {
  const start = segs[startIdx];
  if (!start) return { points: [], indices: [] };
  const used = new Set<number>([startIdx]);
  const points: Pt[] = [{ ...start.a }, { ...start.b }];
  const indices = [startIdx];
  const unit = (from: Pt, to: Pt) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const l = Math.hypot(dx, dy);
    return l > 1e-9 ? { x: dx / l, y: dy / l } : null;
  };
  const extend = (atEnd: boolean) => {
    for (;;) {
      const tip = atEnd ? points[points.length - 1] : points[0];
      const prev = atEnd ? points[points.length - 2] : points[1];
      const dir = unit(prev, tip);
      if (!dir) return;
      let best: { idx: number; far: Pt; dot: number } | null = null;
      segs.forEach((sg, idx) => {
        if (!sg || used.has(idx)) return;
        const ends: Array<[Pt, Pt]> = [[sg.a, sg.b], [sg.b, sg.a]];
        for (const [near, far] of ends) {
          if (Math.hypot(near.x - tip.x, near.y - tip.y) > tolPx) continue;
          const nd = unit(tip, far);
          if (!nd) continue;
          const dot = dir.x * nd.x + dir.y * nd.y; // cos sudut belok
          if (dot <= 1e-9) continue; // belok ≥ 90° → bukan sambungan
          if (!best || dot > best.dot) best = { idx, far, dot };
        }
      });
      if (!best) return;
      const b = best as { idx: number; far: Pt; dot: number };
      used.add(b.idx);
      if (atEnd) { points.push({ ...b.far }); indices.push(b.idx); }
      else { points.unshift({ ...b.far }); indices.unshift(b.idx); }
    }
  };
  extend(true);
  extend(false);
  return { points, indices };
}

// ----- Insert Kolom -----
function segmentIntersection(a: GridAxisSegment, b: GridAxisSegment, ppm: number): Pt | null {
  const ra = (a.rotation * Math.PI) / 180, rb = (b.rotation * Math.PI) / 180;
  const d1 = { x: Math.cos(ra) * a.lengthM * ppm, y: Math.sin(ra) * a.lengthM * ppm };
  const d2 = { x: Math.cos(rb) * b.lengthM * ppm, y: Math.sin(rb) * b.lengthM * ppm };
  const den = d1.x * d2.y - d1.y * d2.x;
  const l1 = Math.hypot(d1.x, d1.y), l2 = Math.hypot(d2.x, d2.y);
  if (l1 < 1e-9 || l2 < 1e-9 || Math.abs(den) < 1e-9 * l1 * l2) return null; // sejajar
  const wx = b.origin.x - a.origin.x, wy = b.origin.y - a.origin.y;
  const t = (wx * d2.y - wy * d2.x) / den;
  const u = (wx * d1.y - wy * d1.x) / den;
  const eps1 = 1e-3 / Math.max(1e-9, a.lengthM), eps2 = 1e-3 / Math.max(1e-9, b.lengthM);
  if (t < -eps1 || t > 1 + eps1 || u < -eps2 || u > 1 + eps2) return null;
  return { x: a.origin.x + d1.x * t, y: a.origin.y + d1.y * t };
}

// Semua persilangan garis grid (grid induk + garis tambahan + grid hasil
// merge) dalam koordinat dunia px, tanpa duplikat.
export function gridLineIntersections(g: StructuralGrid, ppm: number): Pt[] {
  const segs: GridAxisSegment[] = [...gridAxisSegments(g, ppm)];
  for (const child of g.merged ?? []) segs.push(...gridAxisSegments({ ...child, merged: undefined }, ppm));
  const out: Pt[] = [];
  const tol = 0.01 * ppm; // 1 cm
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segmentIntersection(segs[i], segs[j], ppm);
      if (!p) continue;
      if (out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= tol)) continue;
      out.push(p);
    }
  }
  return out;
}

// Sisipkan kolom di setiap persilangan garis grid di dalam persegi seleksi
// (px dunia). Node grid yang dinonaktifkan pada level aktif diaktifkan lagi;
// persilangan lain tanpa kolom mendapat kolom sisipan.
export function insertColumnsInRect(
  g: StructuralGrid,
  rect: { x0: number; y0: number; x1: number; y1: number },
  levelId: string | undefined,
  ppm: number,
): { grid: StructuralGrid; added: number } {
  const xMin = Math.min(rect.x0, rect.x1), xMax = Math.max(rect.x0, rect.x1);
  const yMin = Math.min(rect.y0, rect.y1), yMax = Math.max(rect.y0, rect.y1);
  const tol = 0.01 * ppm;
  const tolM = 0.01;
  const pts = gridLineIntersections(g, ppm).filter((p) => p.x >= xMin - 1e-6 && p.x <= xMax + 1e-6 && p.y >= yMin - 1e-6 && p.y <= yMax + 1e-6);
  // Kolom yang sudah tampil (induk + anak merge) di koordinat dunia.
  const existing: Pt[] = [];
  for (const grid of [g, ...(g.merged ?? []).map((c) => ({ ...c, merged: undefined }))]) {
    for (const c of gridColumnPoints(grid, levelId)) existing.push(gridLocalToWorld(grid, c.mx, c.my, ppm));
  }
  const { spansX, spansY } = spansForLevel(g, levelId);
  const posX = axisPositions(spansX), posY = axisPositions(spansY);
  let disabled = levelId ? [...(g.perLevel?.[levelId]?.disabledNodes ?? [])] : [];
  const inserted = [...(g.insertedColumns ?? [])];
  let added = 0;
  for (const p of pts) {
    if (existing.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= tol)) continue;
    const local = gridWorldToLocal(g, p, ppm);
    if (!g.lineOnly && levelId) {
      const i = posX.findIndex((x) => Math.abs(x - local.x) <= tolM);
      const j = posY.findIndex((y) => Math.abs(y - local.y) <= tolM);
      const key = `${i},${j}`;
      if (i >= 0 && j >= 0 && disabled.includes(key)) {
        disabled = disabled.filter((k) => k !== key);
        existing.push(p);
        if (!isColumnClipped(g, posX[i], posY[j])) { added++; continue; }
      }
    }
    inserted.push({
      id: `ic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      x: Number(local.x.toFixed(4)),
      y: Number(local.y.toFixed(4)),
    });
    existing.push(p);
    added++;
  }
  if (!added) return { grid: g, added: 0 };
  const perLevel = levelId && g.perLevel?.[levelId]
    ? { ...g.perLevel, [levelId]: { ...g.perLevel[levelId], disabledNodes: disabled.length ? disabled : undefined } }
    : g.perLevel;
  return { grid: { ...g, perLevel, insertedColumns: inserted.length ? inserted : undefined }, added };
}

// Jarak titik (px dunia) ke as terdekat pada grid.
export function distanceToGrid(g: StructuralGrid, p: { x: number; y: number }, ppm: number): number {
  let best = Infinity;
  for (const seg of gridAxisSegments(g, ppm)) {
    const a = (seg.rotation * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const len = seg.lengthM * ppm;
    const t = Math.max(0, Math.min(len, (p.x - seg.origin.x) * dx + (p.y - seg.origin.y) * dy));
    const d = Math.hypot(p.x - (seg.origin.x + dx * t), p.y - (seg.origin.y + dy * t));
    if (d < best) best = d;
  }
  for (const child of g.merged ?? []) best = Math.min(best, distanceToGrid({ ...child, merged: undefined }, p, ppm));
  return best;
}

// Gabungkan grid sumber ke grid target secara utuh (as + kolom + clip),
// termasuk anak-anak hasil merge sebelumnya. Grid sumber menjadi anak target.
export function mergeGridInto(target: StructuralGrid, source: StructuralGrid): StructuralGrid {
  const { merged: sourceChildren, ...sourceBase } = source;
  return {
    ...target,
    merged: [
      ...(target.merged ?? []),
      { ...sourceBase, enabled: true },
      ...(sourceChildren ?? []).map((c) => ({ ...c, enabled: true, merged: undefined })),
    ],
  };
}

// Pisahkan anak merge kembali menjadi grid mandiri.
export function unmergeGridChild(
  parent: StructuralGrid,
  childIdx: number,
): { parent: StructuralGrid; child: StructuralGrid | undefined } {
  const list = parent.merged ?? [];
  const child = list[childIdx];
  const rest = list.filter((_, i) => i !== childIdx);
  return { parent: { ...parent, merged: rest.length ? rest : undefined }, child: child ? { ...child, enabled: true } : undefined };
}

// Geser grid beserta garis tergabung & grid hasil merge (terikat).
export function moveGridLinked(g: StructuralGrid, origin: { x: number; y: number }): StructuralGrid {
  const dx = origin.x - g.origin.x;
  const dy = origin.y - g.origin.y;
  return translateGridLinked({ ...g }, dx, dy);
}

function translateGridLinked(g: StructuralGrid, dx: number, dy: number): StructuralGrid {
  return {
    ...g,
    origin: { x: g.origin.x + dx, y: g.origin.y + dy },
    extraLines: g.extraLines?.map((el) => ({
      ...el,
      origin: { x: el.origin.x + dx, y: el.origin.y + dy },
      ...(el.points ? { points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : {}),
    })),
    merged: g.merged?.map((c) => translateGridLinked(c, dx, dy)),
  };
}

// Ubah rotasi grid; garis tergabung & grid hasil merge ikut berputar di
// sekitar origin grid induk.
export function rotateGridLinked(g: StructuralGrid, rotation: number): StructuralGrid {
  const delta = rotation - (g.rotation ?? 0);
  if (!delta) return { ...g, rotation };
  const r = (delta * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const pivot = g.origin;
  const rot = (p: { x: number; y: number }) => {
    const x = p.x - pivot.x, y = p.y - pivot.y;
    return { x: pivot.x + x * c - y * s, y: pivot.y + x * s + y * c };
  };
  const rotLine = (el: ExtraLine): ExtraLine => ({
    ...el,
    origin: rot(el.origin),
    rotation: el.rotation + delta,
    ...(el.points ? { points: el.points.map(rot) } : {}),
  });
  return {
    ...g,
    rotation,
    extraLines: g.extraLines?.map(rotLine),
    merged: g.merged?.map((child) => ({
      ...child,
      origin: rot(child.origin),
      rotation: (child.rotation ?? 0) + delta,
      extraLines: child.extraLines?.map(rotLine),
    })),
  };
}
