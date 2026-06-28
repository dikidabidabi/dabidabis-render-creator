// Master Plan — model data, storage, helpers.
// Disimpan di localStorage agar persistent lintas halaman tanpa migrasi IDB.

export type MasterFunction = "komersial" | "fasum" | "rth";

export type Vec2 = { x: number; y: number };

export type MassingBlock = {
  id: string;            // "block-01"
  name: string;
  fn: MasterFunction;
  // Footprint axis-aligned bounds (meter), origin di pusat tapak.
  // Selalu disimpan untuk back-compat (presentasi & 3D fallback).
  x: number;             // pusat X
  z: number;             // pusat Z (= sumbu Y di kanvas 2D, +Y selatan)
  w: number;             // lebar (X)
  d: number;             // dalam (Z)
  height: number;        // meter
  floors: number;        // jumlah lantai (untuk GFA)
  // Polygon footprint riil di koordinat dunia (x, z meters).
  // Jika kosong → diturunkan dari rect (x,z,w,d). Wajib counter-clockwise tidak diharuskan.
  polygon?: Vec2[];
  // Rotasi visual di plan (radian, opsional — untuk back-compat tetap pakai polygon untuk bentuk).
  rotation?: number;
  detailedSketchTitle?: string;
  detailedAt?: number;
};

export type MasterPlan = {
  blocks: MassingBlock[];
  siteSize: number;      // sisi tapak (meter), default 200
  // Polygon lahan (opsional). Bila kosong → kotak siteSize×siteSize berpusat (0,0).
  sitePolygon?: Vec2[];
  // Parameter regulasi
  kdbPct?: number;       // 0..100
  klbCoef?: number;      // pengali luas lahan
  kdhPct?: number;       // 0..100
  // Orientasi utara (radian, 0 = atas/−Y).
  northRot?: number;
  // Skala (denominator) tampilan kanvas.
  scaleDenom?: number;   // mis. 500 → 1:500
  updatedAt: number;
};

export const MP_STORAGE_KEY = "dabidabis-masterplan-v1";
export const MP_PENDING_DETAIL_KEY = "dabidabis-masterplan-pending-detail";

export const FUNCTION_META: Record<MasterFunction, { label: string; color: string; hex: number }> = {
  komersial: { label: "Komersial", color: "#dc2626", hex: 0xdc2626 },
  fasum:     { label: "Fasilitas Umum", color: "#2563eb", hex: 0x2563eb },
  rth:       { label: "RTH / Terbuka", color: "#16a34a", hex: 0x16a34a },
};

export function emptyPlan(): MasterPlan {
  return {
    blocks: [],
    siteSize: 200,
    kdbPct: 60,
    klbCoef: 3,
    kdhPct: 20,
    northRot: 0,
    scaleDenom: 500,
    updatedAt: Date.now(),
  };
}

export function loadPlan(): MasterPlan {
  if (typeof window === "undefined") return emptyPlan();
  try {
    const raw = window.localStorage.getItem(MP_STORAGE_KEY);
    if (!raw) return emptyPlan();
    const j = JSON.parse(raw);
    const blocks: MassingBlock[] = Array.isArray(j.blocks)
      ? j.blocks
          .map((b: any) => normalizeBlock(b))
          .filter(Boolean) as MassingBlock[]
      : [];
    const base = emptyPlan();
    return {
      blocks,
      siteSize: Number.isFinite(j.siteSize) && j.siteSize > 0 ? Number(j.siteSize) : base.siteSize,
      sitePolygon: Array.isArray(j.sitePolygon) ? sanitizePoly(j.sitePolygon) : undefined,
      kdbPct: numOr(j.kdbPct, base.kdbPct),
      klbCoef: numOr(j.klbCoef, base.klbCoef),
      kdhPct: numOr(j.kdhPct, base.kdhPct),
      northRot: numOr(j.northRot, 0),
      scaleDenom: numOr(j.scaleDenom, 500),
      updatedAt: Number(j.updatedAt) || Date.now(),
    };
  } catch {
    return emptyPlan();
  }
}

function numOr(v: any, d: number | undefined): number | undefined {
  return Number.isFinite(Number(v)) ? Number(v) : d;
}

function sanitizePoly(arr: any[]): Vec2[] | undefined {
  const out: Vec2[] = [];
  for (const p of arr) {
    if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
      out.push({ x: Number(p.x), y: Number(p.y) });
    }
  }
  return out.length >= 3 ? out : undefined;
}

export function savePlan(plan: MasterPlan): void {
  if (typeof window === "undefined") return;
  const next = { ...plan, updatedAt: Date.now() };
  window.localStorage.setItem(MP_STORAGE_KEY, JSON.stringify(next));
  try {
    window.dispatchEvent(new CustomEvent("masterplan:update"));
  } catch {}
}

function normalizeBlock(b: any): MassingBlock | null {
  if (!b || typeof b !== "object") return null;
  const fn: MasterFunction =
    b.fn === "komersial" || b.fn === "fasum" || b.fn === "rth" ? b.fn : "komersial";
  const n = (k: string, d: number) => (Number.isFinite(Number(b[k])) ? Number(b[k]) : d);
  const polygon = Array.isArray(b.polygon) ? sanitizePoly(b.polygon) : undefined;
  let x = n("x", 0), z = n("z", 0), w = Math.max(2, n("w", 20)), d2 = Math.max(2, n("d", 20));
  if (polygon) {
    const bb = polyBounds(polygon);
    x = (bb.minX + bb.maxX) / 2;
    z = (bb.minY + bb.maxY) / 2;
    w = Math.max(0.5, bb.maxX - bb.minX);
    d2 = Math.max(0.5, bb.maxY - bb.minY);
  }
  return {
    id: String(b.id || `block-${Math.random().toString(36).slice(2, 8)}`),
    name: String(b.name || "Blok"),
    fn,
    x, z, w, d: d2,
    height: Math.max(0.5, n("height", fn === "rth" ? 0.5 : 12)),
    floors: Math.max(1, Math.round(n("floors", fn === "rth" ? 1 : 3))),
    polygon,
    rotation: Number.isFinite(Number(b.rotation)) ? Number(b.rotation) : 0,
    detailedSketchTitle: typeof b.detailedSketchTitle === "string" ? b.detailedSketchTitle : undefined,
    detailedAt: Number.isFinite(Number(b.detailedAt)) ? Number(b.detailedAt) : undefined,
  };
}

export function nextBlockId(plan: MasterPlan): string {
  let n = plan.blocks.length + 1;
  const taken = new Set(plan.blocks.map((b) => b.id));
  while (taken.has(`block-${String(n).padStart(2, "0")}`)) n++;
  return `block-${String(n).padStart(2, "0")}`;
}

// Polygon util
export function polyBounds(poly: Vec2[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function polyArea(poly: Vec2[]): number {
  if (!poly || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function polyCentroid(poly: Vec2[]): Vec2 {
  if (!poly || poly.length === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    // fallback: mean
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p.x; sy += p.y; }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  a /= 2;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function blockPolygon(b: MassingBlock): Vec2[] {
  if (b.polygon && b.polygon.length >= 3) return b.polygon;
  const hx = b.w / 2, hz = b.d / 2;
  // axis-aligned rect with optional rotation around (x,z)
  const corners: Vec2[] = [
    { x: -hx, y: -hz },
    { x:  hx, y: -hz },
    { x:  hx, y:  hz },
    { x: -hx, y:  hz },
  ];
  const r = b.rotation ?? 0;
  const c = Math.cos(r), s = Math.sin(r);
  return corners.map((p) => ({ x: b.x + p.x * c - p.y * s, y: b.z + p.x * s + p.y * c }));
}

export function blockFootprintArea(b: MassingBlock): number {
  return polyArea(blockPolygon(b));
}

export function blockGFA(b: MassingBlock): number {
  if (b.fn === "rth") return 0;
  return blockFootprintArea(b) * Math.max(1, b.floors);
}

export function totalsByFunction(plan: MasterPlan): Record<MasterFunction, { gfa: number; footprint: number; count: number }> {
  const out: Record<MasterFunction, { gfa: number; footprint: number; count: number }> = {
    komersial: { gfa: 0, footprint: 0, count: 0 },
    fasum: { gfa: 0, footprint: 0, count: 0 },
    rth: { gfa: 0, footprint: 0, count: 0 },
  };
  for (const b of plan.blocks) {
    out[b.fn].gfa += blockGFA(b);
    out[b.fn].footprint += blockFootprintArea(b);
    out[b.fn].count += 1;
  }
  return out;
}

export function sitePolygonOf(plan: MasterPlan): Vec2[] {
  if (plan.sitePolygon && plan.sitePolygon.length >= 3) return plan.sitePolygon;
  const s = plan.siteSize / 2;
  return [
    { x: -s, y: -s },
    { x:  s, y: -s },
    { x:  s, y:  s },
    { x: -s, y:  s },
  ];
}

export function siteAreaM2(plan: MasterPlan): number {
  return polyArea(sitePolygonOf(plan));
}
