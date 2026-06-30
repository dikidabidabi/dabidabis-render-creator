// Bidirectional sync between Masterplan canvas and detail Sketch.
//
// Masterplan dan Sketsa keduanya merupakan instance `SketchPage` dengan
// localStorage berbeda:
//   - Masterplan → "dabidabis_masterplan_canvas_v1"
//   - Sketsa     → "dabidabis_sketch_v2"
//
// Tombol "→" di panel Level Masterplan memanggil `exportBuildingToSketch`,
// yang membuat (atau mem-pakai-ulang) sketsa pada storage sketsa dengan:
//  • 1 level "Lahan" (mdpl 0) berisi polygon persil sebagai layer "Lahan".
//  • N level "LT 1..N" sesuai jumlah lapis bangunan + sub-bangunan urut MDPL.
//  • Masing-masing level berisi 1 layer "Ruang Referensi N" (polygon footprint
//    bangunan tsb di masterplan), ditandai `isReferenceRoom: true` dan
//    `refSourceLayerId` agar dapat disinkronisasi dua arah.
//
// Catatan: file ini tidak meng-import tipe internal dari sketch.tsx untuk
// menghindari siklus; kita memakai bentuk lepas (loose-typed) lalu sketch.tsx
// akan menormalkan ulang isi storage saat memuatnya.

import { roadCenterline, roadNetworkRegions } from "@/lib/roads";

type AnyPt = { x: number; y: number };

type AnyLayer = {
  id: string;
  name: string;
  points: AnyPt[];
  areaM2: number;
  color: string;
  locked?: boolean;
  levelId?: string;
  coefficient?: number;
  floors?: number;
  isReferenceRoom?: boolean;
  refSourceLayerId?: string;
};

type AnyLevel = {
  id: string;
  name: string;
  mdpl: number;
  opacity: number;
  parentLayerId?: string;
  typicalCount?: number;
};

type AnySketch = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  scale?: string;
  snap?: boolean;
  lines?: unknown[];
  layers: AnyLayer[];
  levels: AnyLevel[];
  activeLevelId: string | null;
  linkedMasterplan?: { rootLayerId: string };
  [k: string]: unknown;
};

const MASTERPLAN_KEY = "dabidabis_masterplan_canvas_v1";
const SKETCH_KEY = "dabidabis_sketch_v2";

const SCALE_TO_PXM: Record<string, number> = {
  "1:100": 1,
  "1:200": 0.5,
  "1:500": 0.2,
  "1:1000": 0.1,
  "1:1200": 100 / 1200,
  "1:1500": 100 / 1500,
  "1:2000": 0.05,
};
// Note: scale denominator vs pixel-per-meter is the sketch's internal
// definition. Saat ekspor, kita TIDAK mengkonversi koordinat — kita
// memakai scale yang sama dengan masterplan agar koordinat px = px.

function readStore(key: string): { sketches: AnySketch[]; openId: string | null } {
  if (typeof window === "undefined") return { sketches: [], openId: null };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { sketches: [], openId: null };
    const j = JSON.parse(raw);
    return {
      sketches: Array.isArray(j?.sketches) ? (j.sketches as AnySketch[]) : [],
      openId: typeof j?.openId === "string" ? j.openId : null,
    };
  } catch {
    return { sketches: [], openId: null };
  }
}

function writeStore(key: string, value: { sketches: AnySketch[]; openId: string | null }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function polyAreaM2(pts: AnyPt[], pxPerMeter: number): number {
  if (!pts || pts.length < 3 || pxPerMeter <= 0) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2 / (pxPerMeter * pxPerMeter);
}

function pxPerMeterOf(scale: string | undefined): number {
  if (!scale) return 1;
  const v = SCALE_TO_PXM[scale];
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function isLahan(name: string) {
  return name.trim().toLowerCase().startsWith("lahan");
}

/** Cari descendant rekursif (sub & sub-of-sub) sebuah rootLayerId.
 *  Kembalikan array layer + level pasangannya, terurut MDPL menaik (induk dulu). */
function collectBuildingChain(
  rootLayerId: string,
  layers: AnyLayer[],
  levels: AnyLevel[],
): { layer: AnyLayer; level: AnyLevel }[] {
  const out: { layer: AnyLayer; level: AnyLevel }[] = [];
  const visited = new Set<string>();
  const walk = (lid: string) => {
    if (visited.has(lid)) return;
    visited.add(lid);
    const lay = layers.find((l) => l.id === lid);
    const lvl = lay ? levels.find((lv) => lv.id === lay.levelId) : undefined;
    if (lay && lvl) out.push({ layer: lay, level: lvl });
    // Cari sub-level yang parentLayerId === lid, lalu semua layer di level itu.
    for (const subLvl of levels) {
      if (subLvl.parentLayerId !== lid) continue;
      const subLayers = layers.filter((ly) => ly.levelId === subLvl.id && !isLahan(ly.name));
      for (const sl of subLayers) walk(sl.id);
    }
  };
  walk(rootLayerId);
  out.sort((a, b) => a.level.mdpl - b.level.mdpl);
  return out;
}

/** Cari polygon persil (region "Lahan" yang memuat sebuah titik). */
function findParcelForPoint(
  mpSketch: AnySketch,
  point: AnyPt,
): AnyPt[] | null {
  const pxm = pxPerMeterOf(mpSketch.scale);
  const lahan = mpSketch.layers.find((l) => isLahan(l.name) && l.points.length >= 3);
  if (!lahan) return null;
  const sitePolyM = lahan.points.map((p) => ({ x: p.x / pxm, y: p.y / pxm }));
  const roads = ((mpSketch as any).roads || []) as { points: AnyPt[]; widthM: number; kind?: string }[];
  const roadCenters = roads.map((r) => ({
    center: roadCenterline(r as any).map((p) => ({ x: p.x / pxm, y: p.y / pxm })),
    widthM: r.widthM,
  }));
  try {
    const regions = roadNetworkRegions(sitePolyM, roadCenters);
    const pM = { x: point.x / pxm, y: point.y / pxm };
    // pilih region yang centroidnya terdekat dengan footprint center
    let best: { polygon: AnyPt[]; d: number } | null = null;
    for (const r of regions) {
      // titik dalam polygon (ray-cast)
      let inside = false;
      const poly = r.polygon;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect = ((yi > pM.y) !== (yj > pM.y))
          && (pM.x < ((xj - xi) * (pM.y - yi)) / ((yj - yi) || 1e-9) + xi);
        if (intersect) inside = !inside;
      }
      if (inside) {
        const d = Math.hypot(r.centroid.x - pM.x, r.centroid.y - pM.y);
        if (!best || d < best.d) best = { polygon: r.polygon, d };
      }
    }
    if (best) {
      // konversi balik ke px sketsa tujuan (pxPerMeter yang sama dengan masterplan)
      return best.polygon.map((p) => ({ x: p.x * pxm, y: p.y * pxm }));
    }
  } catch {
    // ignore
  }
  return sitePolyM.map((p) => ({ x: p.x * pxm, y: p.y * pxm }));
}

function centroid(pts: AnyPt[]): AnyPt {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / Math.max(1, pts.length), y: sy / Math.max(1, pts.length) };
}

/** Ekspor bangunan di sketsa masterplan ke storage sketsa.
 *  Return: id sketsa target di storage SKETCH_KEY (untuk navigasi). */
export function exportBuildingToSketch(opts: {
  masterplanSketchId: string;
  rootLayerId: string;
}): { sketchId: string } | null {
  if (typeof window === "undefined") return null;

  const mpStore = readStore(MASTERPLAN_KEY);
  const mp = mpStore.sketches.find((s) => s.id === opts.masterplanSketchId);
  if (!mp) return null;
  const rootLayer = mp.layers.find((l) => l.id === opts.rootLayerId);
  if (!rootLayer) return null;

  const chain = collectBuildingChain(opts.rootLayerId, mp.layers, mp.levels);
  if (chain.length === 0) return null;

  const pxm = pxPerMeterOf(mp.scale);
  const parcel = findParcelForPoint(mp, centroid(rootLayer.points)) ?? rootLayer.points;

  // Cari sketsa target di SKETCH_KEY
  const skStore = readStore(SKETCH_KEY);
  let target = skStore.sketches.find((s) => s.linkedMasterplan?.rootLayerId === opts.rootLayerId);
  const isNew = !target;

  const now = Date.now();
  const buildingName = rootLayer.name || "Bangunan";

  // Susun levels: Lahan (mdpl 0) + LT 1..N sesuai urut MDPL chain
  const lvlLahan: AnyLevel = {
    id: newId("LV"),
    name: "Lahan",
    mdpl: 0,
    opacity: 0.5,
  };
  const newLevels: AnyLevel[] = [lvlLahan];
  const newLayers: AnyLayer[] = [];

  // Layer "Lahan"
  const lahanArea = polyAreaM2(parcel, pxm);
  newLayers.push({
    id: newId("LY"),
    name: "Lahan",
    points: parcel.map((p) => ({ x: p.x, y: p.y })),
    areaM2: lahanArea,
    color: "#9ca3af",
    locked: true,
    levelId: lvlLahan.id,
    coefficient: 0,
    floors: 1,
  });

  // Tiap layer pada chain → 1 level baru "LT N" + 1 ruang referensi
  let storeyIdx = 1;
  for (const { layer } of chain) {
    const ltLvl: AnyLevel = {
      id: newId("LV"),
      name: `LT ${storeyIdx}`,
      mdpl: (storeyIdx - 1) * 4 + 0.001 * storeyIdx, // strict urutan; 4 m per lantai
      opacity: 0.5,
    };
    newLevels.push(ltLvl);
    const areaM2 = polyAreaM2(layer.points, pxm);
    newLayers.push({
      id: newId("LY"),
      name: `Ruang Referensi ${storeyIdx}`,
      points: layer.points.map((p) => ({ x: p.x, y: p.y })),
      areaM2,
      color: "#94a3b8",
      locked: false,
      levelId: ltLvl.id,
      coefficient: 0,
      floors: 1,
      isReferenceRoom: true,
      refSourceLayerId: layer.id,
    });
    storeyIdx++;
  }

  if (target) {
    // Re-sync: pertahankan ruang non-referensi & non-Lahan yang sudah digambar pengguna.
    const preserved = target.layers.filter((l) => !l.isReferenceRoom && !isLahan(l.name));
    target.title = buildingName;
    target.scale = mp.scale ?? "1:100";
    target.levels = newLevels;
    // Pasang ulang layer preserved ke level Lahan (atau level pertama) untuk hindari orphan.
    const preservedAttached = preserved.map((l) => ({ ...l, levelId: lvlLahan.id }));
    target.layers = [...newLayers, ...preservedAttached];
    target.activeLevelId = newLevels[1]?.id ?? lvlLahan.id;
    target.linkedMasterplan = { rootLayerId: opts.rootLayerId };
    target.updatedAt = now;
  } else {
    target = {
      id: newId("S"),
      title: buildingName,
      createdAt: now,
      updatedAt: now,
      scale: mp.scale ?? "1:100",
      snap: true,
      lines: [],
      layers: newLayers,
      levels: newLevels,
      activeLevelId: newLevels[1]?.id ?? lvlLahan.id,
      linkedMasterplan: { rootLayerId: opts.rootLayerId },
    };
    skStore.sketches.push(target);
  }

  skStore.openId = target.id;
  writeStore(SKETCH_KEY, skStore);
  return { sketchId: target.id };
}

/** Saat ruang referensi di sketsa diedit, replikasi geometry ke layer asal di masterplan. */
export function syncSketchReferenceToMasterplan(sketchId: string): void {
  if (typeof window === "undefined") return;
  const skStore = readStore(SKETCH_KEY);
  const sk = skStore.sketches.find((s) => s.id === sketchId);
  if (!sk || !sk.linkedMasterplan) return;
  const mpStore = readStore(MASTERPLAN_KEY);
  let dirty = false;
  for (const mp of mpStore.sketches) {
    for (const refLayer of sk.layers) {
      if (!refLayer.isReferenceRoom || !refLayer.refSourceLayerId) continue;
      const target = mp.layers.find((l) => l.id === refLayer.refSourceLayerId);
      if (!target) continue;
      // Bandingkan checksum sederhana untuk hindari loop
      const same =
        target.points.length === refLayer.points.length &&
        target.points.every((p, i) => Math.abs(p.x - refLayer.points[i].x) < 0.01 && Math.abs(p.y - refLayer.points[i].y) < 0.01);
      if (same) continue;
      target.points = refLayer.points.map((p) => ({ x: p.x, y: p.y }));
      target.areaM2 = polyAreaM2(target.points, pxPerMeterOf(mp.scale));
      mp.updatedAt = Date.now();
      dirty = true;
    }
  }
  if (dirty) writeStore(MASTERPLAN_KEY, mpStore);
}

/** Saat sebuah layer bangunan di masterplan diubah, propagate ke sketsa terkait. */
export function syncMasterplanToSketches(masterplanSketchId: string): void {
  if (typeof window === "undefined") return;
  const mpStore = readStore(MASTERPLAN_KEY);
  const mp = mpStore.sketches.find((s) => s.id === masterplanSketchId);
  if (!mp) return;
  const skStore = readStore(SKETCH_KEY);
  let dirty = false;
  for (const sk of skStore.sketches) {
    if (!sk.linkedMasterplan) continue;
    for (const refLayer of sk.layers) {
      if (!refLayer.isReferenceRoom || !refLayer.refSourceLayerId) continue;
      const source = mp.layers.find((l) => l.id === refLayer.refSourceLayerId);
      if (!source) continue;
      const same =
        source.points.length === refLayer.points.length &&
        source.points.every((p, i) => Math.abs(p.x - refLayer.points[i].x) < 0.01 && Math.abs(p.y - refLayer.points[i].y) < 0.01);
      if (same) continue;
      refLayer.points = source.points.map((p) => ({ x: p.x, y: p.y }));
      refLayer.areaM2 = polyAreaM2(refLayer.points, pxPerMeterOf(sk.scale));
      sk.updatedAt = Date.now();
      dirty = true;
    }
  }
  if (dirty) writeStore(SKETCH_KEY, skStore);
}

/** Cek apakah suatu rootLayerId di sketsa masterplan sudah punya sketsa detail terkait. */
export function findLinkedSketchId(rootLayerId: string): string | null {
  const skStore = readStore(SKETCH_KEY);
  const found = skStore.sketches.find((s) => s.linkedMasterplan?.rootLayerId === rootLayerId);
  return found ? found.id : null;
}
