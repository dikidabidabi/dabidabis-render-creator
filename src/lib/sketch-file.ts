// Ekspor / impor / merge sketsa dalam format file JSON (.dabidabi.json).
//
// File hasil unduh berisi SELURUH data sketsa (garis, ruang, level, lantai,
// parkir, jalan, ilustrasi, grid struktur, koordinat, dsb) sehingga ketika
// diunggah kembali ke sketsa kosong, seluruh penggambaran muncul otomatis dan
// otomatis terhubung ke halaman lain (3D, tabulasi, narasi, presentasi) karena
// semuanya membaca store sketsa yang sama.
//
// Merge menggabungkan 2+ sketsa menjadi satu:
//  - Perletakan mengikuti koordinat geo masing-masing (offset dihitung dari
//    selisih lat/lon terhadap sketsa dasar, dikonversi ke px world).
//  - Elevasi disatukan: level dengan MDPL sama digabung menjadi satu level,
//    MDPL berbeda otomatis menghasilkan entri level baru.

import { geoOffsetToWorld, type Geo } from "@/lib/geo";

export type AnySketch = Record<string, any> & {
  id: string;
  title: string;
  levels?: { id: string; mdpl: number; name?: string; parentLayerId?: string }[];
  layers?: { id: string; levelId?: string }[];
  geo?: Geo;
};

/**
 * Data pendamping per-sketsa yang tersimpan di store lain (tabulasi, narasi,
 * perspektif, moodboard, screenshot 3D, dsb). Disertakan di file unduhan agar
 * seluruh isian ikut terbawa hingga ke halaman presentasi.
 */
export type SketchCompanions = {
  /** Store berbentuk map { [sketchId]: value } — nilai untuk sketsa ini. */
  maps: Record<string, unknown>;
  /** Store berbentuk key per sketsa (`prefix_<sketchId>`) — nilai mentah. */
  scoped: Record<string, string>;
};

export type SketchFile = {
  app: "dabidabis";
  kind: "sketch";
  version: 1;
  exportedAt: string;
  sketch: AnySketch;
  companions?: SketchCompanions;
};

export const SKETCH_FILE_EXT = ".dabidabi.json";

/** Store localStorage berbentuk map { [sketchId]: data }. */
const MAP_STORE_KEYS = [
  "dabidabis_narasi_v1", // Halaman Narasi
  "dabidabis_perspektif_v1", // Perspektif / render studio
  "dabidabis_cost_v1", // Halaman Tabulasi (biaya)
  "dabidabis_moodboard_v1", // Moodboard studio
  "dabidabis_slideview_v3", // Tata letak slide presentasi
  "dabidabis_compass_view_v1", // Posisi kompas pada slide
] as const;

/** Prefix localStorage dengan satu key per sketsa: `<prefix><sketchId>`. */
const SCOPED_KEY_PREFIXES = [
  "dabidabis_model3d_shots_", // Library screenshot 3D
  "dabidabis_model3d_view_",
  "dabidabis_masterplan3d_view_",
  "dabidabis_osmH_", // Tinggi bangunan eksisting (press & pull)
  "dabidabis_osmDel_",
] as const;

function safeParse(raw: string | null): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Kumpulkan seluruh data pendamping sebuah sketsa dari localStorage. */
export function collectCompanions(sketchId: string): SketchCompanions {
  const maps: Record<string, unknown> = {};
  const scoped: Record<string, string> = {};
  if (typeof localStorage === "undefined") return { maps, scoped };
  for (const key of MAP_STORE_KEYS) {
    const store = safeParse(localStorage.getItem(key));
    const val = store && typeof store === "object" ? store[sketchId] : undefined;
    if (val !== undefined) maps[key] = val;
  }
  for (const prefix of SCOPED_KEY_PREFIXES) {
    const raw = localStorage.getItem(`${prefix}${sketchId}`);
    if (raw != null) scoped[prefix] = raw;
  }
  return { maps, scoped };
}

/** Tulis kembali data pendamping ke localStorage untuk id sketsa baru. */
export function applyCompanions(
  companions: SketchCompanions | undefined,
  sketchId: string,
): void {
  if (!companions || typeof localStorage === "undefined") return;
  const notify = (key: string, value: string) => {
    try {
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
    } catch {
      /* ignore */
    }
  };
  for (const [key, val] of Object.entries(companions.maps ?? {})) {
    if (val === undefined) continue;
    const store = safeParse(localStorage.getItem(key)) ?? {};
    if (typeof store !== "object") continue;
    (store as any)[sketchId] = val;
    const next = JSON.stringify(store);
    try {
      localStorage.setItem(key, next);
      notify(key, next);
    } catch {
      /* kuota penuh — lewati */
    }
  }
  for (const [prefix, raw] of Object.entries(companions.scoped ?? {})) {
    const key = `${prefix}${sketchId}`;
    try {
      localStorage.setItem(key, raw);
      notify(key, raw);
    } catch {
      /* kuota penuh — lewati */
    }
  }
}

/** Gabungkan beberapa set companions (dipakai saat merge sketsa). */
export function mergeCompanions(list: (SketchCompanions | undefined)[]): SketchCompanions {
  const out: SketchCompanions = { maps: {}, scoped: {} };
  for (const c of list) {
    if (!c) continue;
    for (const [k, v] of Object.entries(c.maps ?? {})) {
      const prev = out.maps[k];
      if (Array.isArray(prev) && Array.isArray(v)) out.maps[k] = [...prev, ...v];
      else if (prev && typeof prev === "object" && v && typeof v === "object")
        out.maps[k] = { ...(prev as object), ...(v as object) };
      else if (prev === undefined) out.maps[k] = v;
    }
    for (const [k, v] of Object.entries(c.scoped ?? {})) {
      if (out.scoped[k] === undefined) out.scoped[k] = v;
    }
  }
  return out;
}

// ---------- Ekspor ----------

export function buildSketchFile(sketch: AnySketch): SketchFile {
  return {
    app: "dabidabis",
    kind: "sketch",
    version: 1,
    exportedAt: new Date().toISOString(),
    sketch: JSON.parse(JSON.stringify(sketch)),
    companions: collectCompanions(sketch.id),
  };
}

export function sketchFileName(title: string): string {
  const slug =
    (title || "sketsa")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sketsa";
  return `${slug}${SKETCH_FILE_EXT}`;
}

export function downloadSketchFile(sketch: AnySketch) {
  const file = buildSketchFile(sketch);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sketchFileName(sketch.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// ---------- Impor ----------

export function parseSketchFile(text: string): AnySketch {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File bukan JSON yang valid");
  }
  // Format resmi
  if (data?.app === "dabidabis" && data?.sketch) return data.sketch as AnySketch;
  // Toleransi: file berisi sketsa langsung
  if (data && Array.isArray(data.lines) && Array.isArray(data.layers)) return data as AnySketch;
  // Toleransi: snapshot workspace penuh
  if (data?.entries?.["dabidabis_sketch_v2"]) {
    try {
      const store = JSON.parse(data.entries["dabidabis_sketch_v2"]);
      if (Array.isArray(store?.sketches) && store.sketches[0]) return store.sketches[0];
    } catch {
      /* ignore */
    }
  }
  throw new Error("Struktur file tidak dikenali sebagai sketsa Dabidabi's");
}

// ---------- Util geometri ----------

const ID_SUFFIX_KEYS = ["id"];

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Terapkan translasi (dx,dy) ke setiap objek yang punya field numerik x & y. */
function translateDeep(node: any, dx: number, dy: number, skipKeys: Set<string>): any {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((v) => translateDeep(v, dx, dy, skipKeys));
  if (typeof node.x === "number" && typeof node.y === "number") {
    const out: any = { ...node, x: node.x + dx, y: node.y + dy };
    for (const k of Object.keys(out)) {
      if (k === "x" || k === "y") continue;
      if (skipKeys.has(k)) continue;
      out[k] = translateDeep(out[k], dx, dy, skipKeys);
    }
    return out;
  }
  const out: any = Array.isArray(node) ? [] : { ...node };
  for (const k of Object.keys(out)) {
    if (skipKeys.has(k)) continue;
    out[k] = translateDeep(out[k], dx, dy, skipKeys);
  }
  return out;
}

const ENTITY_ARRAYS = [
  "lines",
  "layers",
  "floors",
  "circles",
  "parkingAreas",
  "ramps",
  "axes",
  "roads",
  "illustrations",
  "doors",
  "structuralGridExtras",
  "sectionCuts",
] as const;

export type MergeOptions = {
  /** px per meter pada kanvas (dihitung dari skala sketsa dasar). */
  pxPerMeter: number;
  /** Judul sketsa hasil merge. */
  title?: string;
  /** Id sketsa hasil. */
  id?: string;
};

export type MergeResult = {
  sketch: AnySketch;
  newLevels: number;
  mergedLevels: number;
};

/**
 * Gabungkan beberapa sketsa. `sources[0]` menjadi dasar (koordinat, skala,
 * rotasi grid, geo). Sketsa berikutnya digeser sesuai selisih koordinat geo.
 */
export function mergeSketches(sources: AnySketch[], opts: MergeOptions): MergeResult {
  if (sources.length === 0) throw new Error("Tidak ada sketsa untuk digabung");
  const base: AnySketch = JSON.parse(JSON.stringify(sources[0]));
  const now = Date.now();
  base.id = opts.id ?? newId("S");
  base.title = opts.title ?? `Merge — ${sources.map((s) => s.title).join(" + ")}`;
  base.createdAt = now;
  base.updatedAt = now;
  delete base.linkedMasterplan;

  for (const arr of ENTITY_ARRAYS) if (!Array.isArray(base[arr])) base[arr] = [];
  if (!Array.isArray(base.levels) || base.levels.length === 0) {
    base.levels = [{ id: newId("L"), name: "Level 1", mdpl: 0 }];
  }
  if (!base.activeLevelId) base.activeLevelId = base.levels[0].id;

  const mdplKey = (v: number) => (Math.round((Number(v) || 0) * 1000) / 1000).toFixed(3);
  const levelByMdpl = new Map<string, string>();
  for (const lv of base.levels) levelByMdpl.set(mdplKey(lv.mdpl), lv.id);

  let newLevels = 0;
  let mergedLevels = 0;
  const gridRot = ((Number(base.mmGridRotation) || 0) * Math.PI) / 180;

  for (let i = 1; i < sources.length; i++) {
    const src: AnySketch = JSON.parse(JSON.stringify(sources[i]));
    const tag = `m${i}_`;

    // 1) Offset perletakan berdasarkan koordinat
    let dx = 0;
    let dy = 0;
    if (base.geo && src.geo && typeof src.geo.lat === "number") {
      const off = geoOffsetToWorld(
        base.geo.lat,
        base.geo.lon,
        src.geo.lat,
        src.geo.lon,
        opts.pxPerMeter,
      );
      dx = off.x;
      dy = off.y;
    }

    // 2) Peta level: MDPL sama → gabung, MDPL beda → level baru
    const levelMap = new Map<string, string>();
    for (const lv of src.levels ?? []) {
      const key = mdplKey(lv.mdpl);
      const existing = levelByMdpl.get(key);
      if (existing) {
        levelMap.set(lv.id, existing);
        mergedLevels++;
      } else {
        const nid = `${tag}${lv.id}`;
        base.levels.push({ ...lv, id: nid });
        levelByMdpl.set(key, nid);
        levelMap.set(lv.id, nid);
        newLevels++;
      }
    }
    const mapLevel = (id?: string) =>
      id && levelMap.has(id) ? levelMap.get(id)! : base.activeLevelId;

    // 3) Peta id layer (untuk referensi parentLayerId / layerId)
    const layerMap = new Map<string, string>();
    for (const ly of src.layers ?? []) layerMap.set(ly.id, `${tag}${ly.id}`);
    const mapLayer = (id?: string) => (id && layerMap.has(id) ? layerMap.get(id)! : undefined);

    // parentLayerId pada level yang baru dibuat
    for (const lv of base.levels) {
      if (lv.id.startsWith(tag) && (lv as any).parentLayerId) {
        const m = mapLayer((lv as any).parentLayerId);
        if (m) (lv as any).parentLayerId = m;
      }
    }

    // 4) Translasi + remap entitas
    for (const arr of ENTITY_ARRAYS) {
      const list = Array.isArray(src[arr]) ? src[arr] : [];
      for (const rawItem of list) {
        let item: any = rawItem;
        if (arr === "parkingAreas") {
          // pointsLocal berada di frame lokal grid → offset diputar balik.
          const cs = Math.cos(-gridRot);
          const sn = Math.sin(-gridRot);
          const ldx = dx * cs - dy * sn;
          const ldy = dx * sn + dy * cs;
          item = translateDeep(item, ldx, ldy, new Set<string>());
        } else {
          item = translateDeep(item, dx, dy, new Set<string>(["nx", "ny"]));
        }
        if (typeof item.id === "string") item.id = `${tag}${item.id}`;
        if ("levelId" in item) item.levelId = mapLevel(item.levelId);
        if (item.parentLayerId) item.parentLayerId = mapLayer(item.parentLayerId) ?? undefined;
        if (item.layerId) item.layerId = mapLayer(item.layerId) ?? item.layerId;
        base[arr].push(item);
      }
    }

    // 5) Grid struktur tambahan dari sumber (primer → jadi extra)
    if (src.structuralGrid) {
      const g = translateDeep(src.structuralGrid, dx, dy, new Set<string>());
      if (typeof g.id === "string") g.id = `${tag}${g.id}`;
      if (g.levelId) g.levelId = mapLevel(g.levelId);
      base.structuralGridExtras.push(g);
    }

    // 6) Material per edge (key segmentId ikut di-tag)
    if (src.edgeAttrs && typeof src.edgeAttrs === "object") {
      base.edgeAttrs = { ...(base.edgeAttrs ?? {}) };
      for (const [k, v] of Object.entries(src.edgeAttrs)) base.edgeAttrs[`${tag}${k}`] = v as any;
    }
  }

  // Urutkan level menaik berdasarkan MDPL agar list elevasi rapi
  base.levels.sort((a: any, b: any) => (Number(a.mdpl) || 0) - (Number(b.mdpl) || 0));
  void ID_SUFFIX_KEYS;

  return { sketch: base, newLevels, mergedLevels };
}
