export type FunctionZone = {
  id: string;
  name: string;
  color: string;
};

const ZONE_COLORS = [
  "#13a8e1",
  "#ef4444",
  "#16a34a",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#0891b2",
  "#84cc16",
  "#f97316",
  "#6366f1",
] as const;

export function newFunctionZone(existing: FunctionZone[]): FunctionZone {
  const id = `zona-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: `Zona ${existing.length + 1}`,
    color: ZONE_COLORS[existing.length % ZONE_COLORS.length],
  };
}

export function normalizeFunctionZones(value: unknown): FunctionZone[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<FunctionZone>;
    const id = typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : `zona-${index + 1}`;
    if (used.has(id)) return [];
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name) return [];
    used.add(id);
    const color = typeof candidate.color === "string" && candidate.color.trim()
      ? candidate.color
      : ZONE_COLORS[index % ZONE_COLORS.length];
    return [{ id, name, color }];
  });
}

export function functionZoneColor(color: string, alpha = 1): string {
  const value = color.trim();
  const hex = value.startsWith("#") ? value.slice(1) : value;
  const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
  if (/^[0-9a-f]{6}$/i.test(full)) {
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return value;
}
export const UNASSIGNED_ZONE_ID = "__unassigned__";
export const UNASSIGNED_ZONE_NAME = "Belum dikelompokkan";
export const UNASSIGNED_ZONE_COLOR = "#bdbdbd";

export type ZoneAreaRoom = {
  areaM2: number;
  functionZoneId?: string | null;
  /** Pengali tipikal lantai (≥ 1). */
  multiplier?: number;
};

export type ZoneAreaGroup = {
  id: string;
  name: string;
  color: string;
  count: number;
  areaM2: number;
  assigned: boolean;
};

/**
 * Kelompokkan ruang berdasarkan zona fungsi Tabulasi. Urutan mengikuti
 * urutan zona; ruang tanpa zona (atau zona yang sudah dihapus) masuk
 * "Belum dikelompokkan" di akhir. Jumlah & luas memakai pengali tipikal.
 */
export function groupRoomsByFunctionZone(rooms: ZoneAreaRoom[], zones: FunctionZone[]): ZoneAreaGroup[] {
  const byId = new Map<string, ZoneAreaGroup>();
  for (const zone of zones) {
    byId.set(zone.id, { id: zone.id, name: zone.name, color: functionZoneColor(zone.color, 1), count: 0, areaM2: 0, assigned: true });
  }
  const unassigned: ZoneAreaGroup = {
    id: UNASSIGNED_ZONE_ID, name: UNASSIGNED_ZONE_NAME, color: UNASSIGNED_ZONE_COLOR, count: 0, areaM2: 0, assigned: false,
  };
  for (const room of rooms) {
    const k = Math.max(1, Math.round(room.multiplier ?? 1));
    const group = (room.functionZoneId && byId.get(room.functionZoneId)) || unassigned;
    group.count += k;
    group.areaM2 += (Number.isFinite(room.areaM2) ? room.areaM2 : 0) * k;
  }
  return [...byId.values(), unassigned].filter((group) => group.count > 0);
}
