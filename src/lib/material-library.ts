import { setProjectItem } from "@/lib/storage/idb-bridge";

export const MATERIAL_LIBRARY_KEY = "dabidabis_material_library_v1";
export const ROOM_MATERIAL_KINDS = ["lantai", "dinding", "plafon"] as const;
export const GENERAL_MATERIAL_KINDS = ["pekerjaan dasar", "fasad"] as const;
export const MATERIAL_KINDS = [...GENERAL_MATERIAL_KINDS.slice(0, 1), ...ROOM_MATERIAL_KINDS, ...GENERAL_MATERIAL_KINDS.slice(1)] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export type RoomMaterialKind = (typeof ROOM_MATERIAL_KINDS)[number];
export type LibraryMaterial = {
  id: string;
  kind: MaterialKind;
  name: string;
  image: string | null;
  description: string;
  product: string;
  code: string;
};
export type RoomMaterials = Partial<Record<RoomMaterialKind, string>>;
export type FacadeDirection = "barat" | "timur" | "utara" | "selatan";
export type GeneralMaterialSelections = {
  foundation: string[];
  facades: Record<FacadeDirection, string[]>;
};
export const EMPTY_GENERAL_MATERIALS: GeneralMaterialSelections = {
  foundation: [],
  facades: { barat: [], timur: [], utara: [], selatan: [] },
};
let pendingSave: Promise<void> = Promise.resolve();

export function loadMaterialLibrary(): LibraryMaterial[] {
  try {
    const value = JSON.parse(localStorage.getItem(MATERIAL_LIBRARY_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): LibraryMaterial[] => {
      if (!item || typeof item.id !== "string" || !MATERIAL_KINDS.includes(item.kind) ||
        typeof item.name !== "string" || (item.image !== null && typeof item.image !== "string")) return [];
      return [{
        id: item.id,
        kind: item.kind,
        name: item.name,
        image: item.image,
        description: typeof item.description === "string" ? item.description : "",
        product: typeof item.product === "string" ? item.product : "",
        code: typeof item.code === "string" ? item.code : "",
      }];
    });
  } catch {
    return [];
  }
}

const DEFAULT_CODES: Record<MaterialKind, string> = {
  "pekerjaan dasar": "PD",
  lantai: "L",
  dinding: "D",
  plafon: "P",
  fasad: "F",
};

export function materialCodes(materials: LibraryMaterial[]): Map<string, string> {
  const counts = new Map<string, number>();
  const result = new Map<string, string>();
  for (const material of materials) {
    const base = (material.code.trim() || DEFAULT_CODES[material.kind]).toUpperCase().replace(/\s+/g, "");
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    result.set(material.id, `${base}${count}`);
  }
  return result;
}

export function normalizeGeneralMaterialSelections(value: unknown): GeneralMaterialSelections {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const facades = source.facades && typeof source.facades === "object" ? source.facades as Record<string, unknown> : {};
  const ids = (entry: unknown) => Array.isArray(entry) ? entry.filter((id): id is string => typeof id === "string" && Boolean(id)) : [];
  return {
    foundation: ids(source.foundation),
    facades: { barat: ids(facades.barat), timur: ids(facades.timur), utara: ids(facades.utara), selatan: ids(facades.selatan) },
  };
}

export async function saveMaterialLibrary(materials: LibraryMaterial[]) {
  const payload = JSON.stringify(materials);
  pendingSave = pendingSave.catch(() => {}).then(async () => {
    await setProjectItem(MATERIAL_LIBRARY_KEY, payload);
  });
  await pendingSave;
}