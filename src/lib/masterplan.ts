// Master Plan — model data, storage, helpers.
// Disimpan di localStorage agar persistent lintas halaman tanpa migrasi IDB.

export type MasterFunction = "komersial" | "fasum" | "rth";

export type MassingBlock = {
  id: string;            // "block-01"
  name: string;
  fn: MasterFunction;
  // Footprint axis-aligned (meter), origin di pusat tapak.
  x: number;             // pusat X
  z: number;             // pusat Z
  w: number;             // lebar (X)
  d: number;             // dalam (Z)
  height: number;        // meter
  floors: number;        // jumlah lantai (untuk GFA)
  detailedSketchTitle?: string;
  detailedAt?: number;
};

export type MasterPlan = {
  blocks: MassingBlock[];
  siteSize: number;      // sisi tapak (meter), default 200
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
  return { blocks: [], siteSize: 200, updatedAt: Date.now() };
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
    return {
      blocks,
      siteSize: Number.isFinite(j.siteSize) && j.siteSize > 0 ? Number(j.siteSize) : 200,
      updatedAt: Number(j.updatedAt) || Date.now(),
    };
  } catch {
    return emptyPlan();
  }
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
  return {
    id: String(b.id || `block-${Math.random().toString(36).slice(2, 8)}`),
    name: String(b.name || "Blok"),
    fn,
    x: n("x", 0),
    z: n("z", 0),
    w: Math.max(2, n("w", 20)),
    d: Math.max(2, n("d", 20)),
    height: Math.max(0.5, n("height", fn === "rth" ? 0.5 : 12)),
    floors: Math.max(1, Math.round(n("floors", fn === "rth" ? 1 : 3))),
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

export function blockGFA(b: MassingBlock): number {
  if (b.fn === "rth") return 0;
  return b.w * b.d * Math.max(1, b.floors);
}

export function totalsByFunction(plan: MasterPlan): Record<MasterFunction, { gfa: number; footprint: number; count: number }> {
  const out: Record<MasterFunction, { gfa: number; footprint: number; count: number }> = {
    komersial: { gfa: 0, footprint: 0, count: 0 },
    fasum: { gfa: 0, footprint: 0, count: 0 },
    rth: { gfa: 0, footprint: 0, count: 0 },
  };
  for (const b of plan.blocks) {
    out[b.fn].gfa += blockGFA(b);
    out[b.fn].footprint += b.w * b.d;
    out[b.fn].count += 1;
  }
  return out;
}
