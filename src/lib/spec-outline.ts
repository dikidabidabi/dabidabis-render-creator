import { normalizeGeneralMaterialSelections, type MaterialKind, type RoomMaterials } from "@/lib/material-library";
import { roomWallSpans } from "@/lib/room-wall-spans";

/** Shared Outline Spesifikasi rules used by the presentation slide and the RKS document. */
type SpecPoint = { x: number; y: number };
type SpecLine = Parameters<typeof roomWallSpans>[1][number];
export type SpecSketch = {
  scale: string;
  layers?: Array<{ name: string; points: SpecPoint[]; areaM2: number; levelId?: string; isReferenceRoom?: boolean; roomMaterials?: RoomMaterials }>;
  levels?: Array<{ id: string; name: string; mdpl: number }>;
  lines?: SpecLine[];
  generalMaterials?: unknown;
};
export type SpecMaterialRef = { kind: MaterialKind; materialId: string };
export type SpecLocation = { level: string; rooms: string[]; areaM2?: number };

const FACADE_DIRECTIONS = ["barat", "timur", "utara", "selatan"] as const;

function isExcludedRoom(name: string) {
  const n = name.trim().toLowerCase();
  return n.startsWith("lahan") || n === "void" || n.startsWith("taman");
}

export function sketchMetersPerSketchPx(scale: string): number {
  const major: Record<string, number> = { "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10, "1:1200": 12, "1:1500": 15, "1:2000": 20 };
  return (major[scale] ?? 1) / 80;
}

/** Order: pekerjaan dasar, lantai, dinding, plafon, fasad (Barat, Timur, Utara, Selatan). */
export function collectSpecMaterialRefs(sketch: SpecSketch): SpecMaterialRef[] {
  const refs: SpecMaterialRef[] = [];
  const seen = new Set<string>();
  const add = (kind: MaterialKind, materialId: string | undefined) => {
    if (!materialId) return;
    const key = `${kind}:${materialId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ kind, materialId });
  };
  const general = normalizeGeneralMaterialSelections(sketch.generalMaterials);
  general.foundation.forEach((materialId) => add("pekerjaan dasar", materialId));
  (["lantai", "dinding", "plafon"] as const).forEach((kind) => {
    (sketch.layers ?? []).forEach((layer) => {
      if (layer.isReferenceRoom || isExcludedRoom(layer.name)) return;
      add(kind, layer.roomMaterials?.[kind]);
    });
  });
  FACADE_DIRECTIONS.forEach((direction) => general.facades[direction].forEach((materialId) => add("fasad", materialId)));
  return refs;
}

export function specMaterialArea(sketch: SpecSketch, ref: SpecMaterialRef, levelId?: string): number | null {
  if (ref.kind !== "lantai" && ref.kind !== "dinding" && ref.kind !== "plafon") return null;
  const kind = ref.kind;
  const metersPerPx = sketchMetersPerSketchPx(sketch.scale);
  return (sketch.layers ?? []).reduce((sum, layer) => {
    if (levelId !== undefined && layer.levelId !== levelId) return sum;
    if (layer.isReferenceRoom || isExcludedRoom(layer.name)) return sum;
    if (layer.roomMaterials?.[kind] !== ref.materialId) return sum;
    if (kind !== "dinding") return sum + Math.max(0, Number(layer.areaM2) || 0);
    return sum + roomWallSpans(layer.points, sketch.lines ?? [], layer.levelId)
      .reduce((total, span) => total + span.length * metersPerPx, 0) * 3;
  }, 0);
}

export function formatSpecNumber(n: number, d = 2) {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function specLocationText(location: SpecLocation): string {
  const rooms = location.rooms.join(", ");
  return location.areaM2 === undefined ? rooms : `${rooms} (${formatSpecNumber(location.areaM2, 2)} m²)`;
}

export function specLocations(sketch: SpecSketch, ref: SpecMaterialRef): SpecLocation[] {
  if (ref.kind === "pekerjaan dasar") return [{ level: "Umum", rooms: ["Seluruh bangunan"] }];
  if (ref.kind === "fasad") {
    const general = normalizeGeneralMaterialSelections(sketch.generalMaterials);
    return FACADE_DIRECTIONS.filter((direction) => general.facades[direction].includes(ref.materialId))
      .map((direction) => ({ level: direction[0].toUpperCase() + direction.slice(1), rooms: ["Fasad"] }));
  }
  const kind = ref.kind;
  return [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl).flatMap((level) => {
    const rooms = [...new Set((sketch.layers ?? [])
      .filter((layer) => !layer.isReferenceRoom && layer.levelId === level.id && layer.roomMaterials?.[kind] === ref.materialId)
      .map((layer) => layer.name))].sort((a, b) => a.localeCompare(b, "id"));
    return rooms.length ? [{ level: level.name, rooms, areaM2: specMaterialArea(sketch, ref, level.id) ?? undefined }] : [];
  });
}
