// Bidirectional sync between Masterplan canvas and detail Sketch.
//
// Masterplan dan Sketsa keduanya merupakan instance `SketchPage` dengan
// localStorage berbeda:
//   - Masterplan → "dabidabis_masterplan_canvas_v1"
//   - Sketsa     → "dabidabis_sketch_v2"
//
// Tombol "→" di panel Level Masterplan memanggil `exportBuildingToSketch`,
// yang membuat (atau mem-pakai-ulang) sketsa pada storage sketsa dengan:
//  • level "LT 1" (mdpl 0) berisi polygon persil sebagai layer "Lahan".
//  • N level "LT 1..N" sesuai jumlah lapis bangunan + sub-bangunan urut MDPL.
//  • Masing-masing level berisi 1 layer "Ruang Referensi N" (polygon footprint
//    bangunan tsb di masterplan), ditandai `isReferenceRoom: true` dan
//    `refSourceLayerId` agar dapat disinkronisasi dua arah.
//
// Catatan: file ini tidak meng-import tipe internal dari sketch.tsx untuk
// menghindari siklus; kita memakai bentuk lepas (loose-typed) lalu sketch.tsx
// akan menormalkan ulang isi storage saat memuatnya.

import {
  roadCorridorPolygon,
  unionFilletedCorridors,
  clipRingsByPolygon,
} from "@/lib/roads";
import polygonClipping from "polygon-clipping";

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
  "1:100": 80,
  "1:200": 40,
  "1:500": 16,
  "1:1000": 8,
  "1:1200": 80 / 12,
  "1:1500": 80 / 15,
  "1:2000": 4,
};
// Harus identik dengan sketch.tsx: pxPerMeter = (8px × 10 minor-grid) / meter-per-major.
// Ini yang membuat angka m² masterplan, persil, jalan, dan sketsa detail sama persis.

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

function metricAreaForLayer(layer: AnyLayer, pxPerMeter: number): number {
  const stored = Number(layer.areaM2);
  return Number.isFinite(stored) && stored >= 0 ? stored : polyAreaM2(layer.points, pxPerMeter);
}

function areaSame(a: number, b: number): boolean {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
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

function pointInPolygon(pt: AnyPt, poly: AnyPt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y))
      && (pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function polyAreaPxAbs(pts: AnyPt[]): number {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function ptsToRing(pts: AnyPt[]): [number, number][] {
  const r: [number, number][] = pts.map((p) => [p.x, p.y]);
  if (r.length > 0) {
    const a = r[0], b = r[r.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  }
  return r;
}

function ringToPts(ring: [number, number][]): AnyPt[] {
  const out: AnyPt[] = ring.map(([x, y]) => ({ x, y }));
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (a.x === b.x && a.y === b.y) out.pop();
  }
  return out;
}

/**
 * Cari polygon persil yang memuat sebuah titik, MENGGUNAKAN ALGORITMA
 * IDENTIK dengan deteksi persil di halaman sketsa (sketch.tsx):
 *   Lahan − union(koridor jalan, fillet 4 m, di-clip oleh Lahan).
 * Bekerja sepenuhnya di koordinat px masterplan agar tidak ada
 * pergeseran akibat konversi unit.
 */
function findParcelForPoint(
  mpSketch: AnySketch,
  point: AnyPt,
): AnyPt[] | null {
  const pxm = pxPerMeterOf(mpSketch.scale);
  const lahan = mpSketch.layers.find((l) => isLahan(l.name) && l.points.length >= 3);
  if (!lahan) return null;
  const lahanPts: AnyPt[] = lahan.points.map((p) => ({ x: p.x, y: p.y }));
  const roads = ((mpSketch as any).roads || []) as {
    id?: string; points: AnyPt[]; widthM: number; kind?: string; createdAt?: number;
  }[];
  if (roads.length === 0) return lahanPts;

  try {
    const FILLET_PX = 4 * pxm;
    const corridors = roads
      .map((rd) => roadCorridorPolygon(rd as any, pxm) as AnyPt[])
      .filter((c) => c.length >= 3);
    if (corridors.length === 0) return lahanPts;

    let unionRings = unionFilletedCorridors(corridors, FILLET_PX);
    unionRings = clipRingsByPolygon(unionRings, lahanPts);
    if (unionRings.length === 0) return lahanPts;

    const lahanSubj = [[ptsToRing(lahanPts)]] as Parameters<typeof polygonClipping.difference>[0];
    const roadSubj = unionRings.map((r) => [
      ptsToRing(r.outer),
      ...r.holes.map((h) => ptsToRing(h)),
    ]) as Parameters<typeof polygonClipping.difference>[0];
    const parcels = polygonClipping.difference(lahanSubj, roadSubj);
    if (!parcels || parcels.length === 0) return lahanPts;

    // Pilih parcel yang memuat titik footprint; fallback: parcel terbesar.
    let best: { pts: AnyPt[]; area: number } | null = null;
    let containing: AnyPt[] | null = null;
    for (const poly of parcels) {
      if (!poly || poly.length === 0) continue;
      const outerPts = ringToPts(poly[0]);
      if (outerPts.length < 3) continue;
      const area = polyAreaPxAbs(outerPts);
      if (!best || area > best.area) best = { pts: outerPts, area };
      if (pointInPolygon(point, outerPts)) {
        containing = outerPts;
        break;
      }
    }
    return containing ?? best?.pts ?? lahanPts;
  } catch {
    return lahanPts;
  }
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

  // Susun levels: LT 1..N sesuai urut MDPL chain. Polygon "Lahan" digabung
  // ke dalam level LT 1 (MDPL 0), tidak dipisah ke level Lahan tersendiri.
  const newLevels: AnyLevel[] = [];
  const newLayers: AnyLayer[] = [];
  const lahanArea = polyAreaM2(parcel, pxm);

  // Tiap layer pada chain → N level baru "LT N" sesuai jumlah lapis (floors) layer tsb
  let storeyIdx = 1;
  for (const { layer } of chain) {
    const layerFloors = Math.max(1, Math.round(Number((layer as any).floors) || 1));
    const areaM2 = metricAreaForLayer(layer, pxm);
    for (let f = 0; f < layerFloors; f++) {
      const ltLvl: AnyLevel = {
        id: newId("LV"),
        name: `LT ${storeyIdx}`,
        // LT 1 sama dengan Lahan di MDPL 0; lantai berikutnya naik 4 m.
        mdpl: (storeyIdx - 1) * 4,
        opacity: 0.5,
      };
      newLevels.push(ltLvl);
      // Tambahkan polygon Lahan ke LT 1 saja (MDPL 0).
      if (storeyIdx === 1) {
        newLayers.push({
          id: newId("LY"),
          name: "Lahan",
          points: parcel.map((p) => ({ x: p.x, y: p.y })),
          areaM2: lahanArea,
          color: "#9ca3af",
          locked: true,
          levelId: ltLvl.id,
          coefficient: 0,
          floors: 1,
        });
      }
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
  }

  // Fallback: jika chain kosong, tetap buat 1 level LT 1 berisi Lahan
  if (newLevels.length === 0) {
    const ltLvl: AnyLevel = { id: newId("LV"), name: "LT 1", mdpl: 0, opacity: 0.5 };
    newLevels.push(ltLvl);
    newLayers.push({
      id: newId("LY"),
      name: "Lahan",
      points: parcel.map((p) => ({ x: p.x, y: p.y })),
      areaM2: lahanArea,
      color: "#9ca3af",
      locked: true,
      levelId: ltLvl.id,
      coefficient: 0,
      floors: 1,
    });
  }
  const lvlFirst = newLevels[0];

  // Propagasi properti yang harus identik dengan masterplan agar koordinat,
  // skala, dan peta tidak bergeser saat berpindah halaman.
  const inheritedProps: Record<string, unknown> = {
    scale: mp.scale ?? "1:100",
    geo: (mp as any).geo, // koordinat map ikut terekspor
    northRotation: (mp as any).northRotation,
    mmGridRotation: (mp as any).mmGridRotation,
    // Sinkronkan data jalan agar perimeter Lahan identik
    roads: ((mp as any).roads || []).map((r: any) => ({
      ...r,
      points: r.points.map((p: AnyPt) => ({ x: p.x, y: p.y })),
    })),
  };

  if (target) {
    // Re-sync: pertahankan ruang non-referensi & non-Lahan yang sudah digambar pengguna.
    const preserved = target.layers.filter((l) => !l.isReferenceRoom && !isLahan(l.name));
    // Buat peta level-lama → level-baru berdasarkan nama level agar layer
    // yang sudah dibuat user tetap berada di level yang benar.
    const oldLevelNameMap = new Map<string, string>(); // oldLevelId → levelName
    if (target.levels) {
      for (const lv of target.levels) oldLevelNameMap.set(lv.id, lv.name);
    }
    const newLevelByName = new Map<string, string>(); // levelName → newLevelId
    for (const lv of newLevels) newLevelByName.set(lv.name, lv.id);

    target.title = buildingName;
    Object.assign(target, inheritedProps);
    target.levels = newLevels;
    // Pasang ulang preserved layers ke level baru yang namanya cocok,
    // fallback ke level pertama (Lahan).
    const preservedAttached = preserved.map((l) => {
      const oldName = l.levelId ? oldLevelNameMap.get(l.levelId) : undefined;
      const matchedNewId = oldName ? newLevelByName.get(oldName) : undefined;
      return { ...l, levelId: matchedNewId ?? lvlFirst.id };
    });
    target.layers = [...newLayers, ...preservedAttached];
    target.activeLevelId = lvlFirst.id;
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
      activeLevelId: lvlFirst.id,
      linkedMasterplan: { rootLayerId: opts.rootLayerId },
      ...inheritedProps,
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
  const skPxm = pxPerMeterOf(sk.scale);
  for (const mp of mpStore.sketches) {
    const mpPxm = pxPerMeterOf(mp.scale);
    for (const refLayer of sk.layers) {
      if (!refLayer.isReferenceRoom || !refLayer.refSourceLayerId) continue;
      const target = mp.layers.find((l) => l.id === refLayer.refSourceLayerId);
      if (!target) continue;
      // Konversi px-sketsa → meter → px-masterplan agar skala beda tidak menggeser.
      const converted = refLayer.points.map((p) => ({
        x: (p.x / skPxm) * mpPxm,
        y: (p.y / skPxm) * mpPxm,
      }));
      const nextAreaM2 = polyAreaM2(converted, mpPxm);
      const same =
        target.points.length === converted.length &&
        target.points.every((p, i) => Math.abs(p.x - converted[i].x) < 0.01 && Math.abs(p.y - converted[i].y) < 0.01);
      if (same && areaSame(target.areaM2, nextAreaM2)) continue;
      target.points = converted;
      target.areaM2 = nextAreaM2;
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
  const mpPxm = pxPerMeterOf(mp.scale);
  for (const sk of skStore.sketches) {
    if (!sk.linkedMasterplan) continue;
    const skPxm = pxPerMeterOf(sk.scale);

    // 1) Deteksi perubahan jumlah lapis (floors) → trigger full re-export agar
    //    jumlah level di sketsa selalu konsisten dengan masterplan.
    const chain = collectBuildingChain(sk.linkedMasterplan.rootLayerId, mp.layers, mp.levels);
    const expectedLT = chain.reduce(
      (sum, { layer }) => sum + Math.max(1, Math.round(Number((layer as any).floors) || 1)),
      0,
    );
    const currentLT = sk.levels.filter((lv) => /^LT\s*\d+/i.test(lv.name)).length;
    if (chain.length > 0 && expectedLT !== currentLT) {
      exportBuildingToSketch({
        masterplanSketchId: mp.id,
        rootLayerId: sk.linkedMasterplan.rootLayerId,
      });
      return; // sketsa sudah ditulis ulang; hindari menimpa ulang dengan snapshot lama.
    }

    // 2) Sinkronisasi data jalan (agar perimeter Lahan tetap identik).
    const mpRoads = ((mp as any).roads || []) as any[];
    const skRoads = ((sk as any).roads || []) as any[];
    const convertedRoads = mpRoads.map((r: any) => ({
      ...r,
      points: r.points.map((p: AnyPt) => ({
        x: (p.x / mpPxm) * skPxm,
        y: (p.y / mpPxm) * skPxm,
      })),
    }));
    const roadsSame =
      convertedRoads.length === skRoads.length &&
      convertedRoads.every((r, i) => {
        const s = skRoads[i];
        return (
          s &&
          r.widthM === s.widthM &&
          r.points.length === s.points.length &&
          r.points.every((p: AnyPt, j: number) => Math.abs(p.x - s.points[j].x) < 0.01 && Math.abs(p.y - s.points[j].y) < 0.01)
        );
      });
    if (!roadsSame) {
      (sk as any).roads = convertedRoads;
      sk.updatedAt = Date.now();
      dirty = true;
    }

    // 3) Sinkronisasi polygon ruang referensi.
    for (const refLayer of sk.layers) {
      if (!refLayer.isReferenceRoom || !refLayer.refSourceLayerId) continue;
      const source = mp.layers.find((l) => l.id === refLayer.refSourceLayerId);
      if (!source) continue;
      const converted = source.points.map((p) => ({
        x: (p.x / mpPxm) * skPxm,
        y: (p.y / mpPxm) * skPxm,
      }));
      const expectedAreaM2 = metricAreaForLayer(source, mpPxm);
      const same =
        refLayer.points.length === converted.length &&
        refLayer.points.every((p, i) => Math.abs(p.x - converted[i].x) < 0.01 && Math.abs(p.y - converted[i].y) < 0.01);
      if (same && areaSame(refLayer.areaM2, expectedAreaM2)) continue;
      refLayer.points = converted;
      refLayer.areaM2 = expectedAreaM2;
      sk.updatedAt = Date.now();
      dirty = true;
    }

    // 4) Update polygon Lahan agar mengikuti perubahan jalan/persil.
    const rootLayer = mp.layers.find((l) => l.id === sk.linkedMasterplan!.rootLayerId);
    if (rootLayer) {
      const newParcel = findParcelForPoint(mp, centroid(rootLayer.points)) ?? rootLayer.points;
      const lahanLayer = sk.layers.find((l) => isLahan(l.name));
      if (lahanLayer) {
        const expectedAreaM2 = polyAreaM2(newParcel, mpPxm);
        const converted = newParcel.map((p) => ({
          x: (p.x / mpPxm) * skPxm,
          y: (p.y / mpPxm) * skPxm,
        }));
        const same =
          lahanLayer.points.length === converted.length &&
          lahanLayer.points.every((p, i) => Math.abs(p.x - converted[i].x) < 0.01 && Math.abs(p.y - converted[i].y) < 0.01);
        if (!same || !areaSame(lahanLayer.areaM2, expectedAreaM2)) {
          lahanLayer.points = converted;
          lahanLayer.areaM2 = expectedAreaM2;
          sk.updatedAt = Date.now();
          dirty = true;
        }
      }
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
