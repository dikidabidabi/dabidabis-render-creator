import { setProjectItem } from "@/lib/storage/idb-bridge";

export const MATERIAL_LIBRARY_KEY = "dabidabis_material_library_v1";
export const MATERIAL_KINDS = ["lantai", "dinding", "plafon"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export type LibraryMaterial = {
  id: string;
  kind: MaterialKind;
  name: string;
  image: string | null;
  description: string;
  product: string;
};
export type RoomMaterials = Partial<Record<MaterialKind, string>>;
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
      }];
    });
  } catch {
    return [];
  }
}

export async function saveMaterialLibrary(materials: LibraryMaterial[]) {
  const payload = JSON.stringify(materials);
  pendingSave = pendingSave.catch(() => {}).then(async () => {
    await setProjectItem(MATERIAL_LIBRARY_KEY, payload);
  });
  await pendingSave;
}