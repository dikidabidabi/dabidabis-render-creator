import { setProjectItem } from "@/lib/storage/idb-bridge";

export const MATERIAL_LIBRARY_KEY = "dabidabis_material_library_v1";
export const MATERIAL_KINDS = ["lantai", "dinding", "plafon"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export type LibraryMaterial = { id: string; kind: MaterialKind; name: string; image: string | null };
export type RoomMaterials = Partial<Record<MaterialKind, string>>;

export function loadMaterialLibrary(): LibraryMaterial[] {
  try {
    const value = JSON.parse(localStorage.getItem(MATERIAL_LIBRARY_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is LibraryMaterial =>
      item && typeof item.id === "string" && MATERIAL_KINDS.includes(item.kind) && typeof item.name === "string" &&
      (item.image === null || typeof item.image === "string"));
  } catch {
    return [];
  }
}

export async function saveMaterialLibrary(materials: LibraryMaterial[]) {
  await setProjectItem(MATERIAL_LIBRARY_KEY, JSON.stringify(materials));
  window.dispatchEvent(new StorageEvent("storage", { key: MATERIAL_LIBRARY_KEY }));
}