import { setProjectItem } from "@/lib/storage/idb-bridge";

export const SKETCH_STORAGE_KEY = "dabidabis_sketch_v2";

type StoredSketch = { id: string; updatedAt?: number; [key: string]: unknown };
type StoredSketches = { sketches: StoredSketch[]; openId: string | null };

export async function patchStoredSketch(
  sketchId: string,
  mutate: (sketch: StoredSketch) => StoredSketch,
): Promise<StoredSketch | null> {
  let store: StoredSketches;
  try {
    const parsed = JSON.parse(localStorage.getItem(SKETCH_STORAGE_KEY) || "null") as StoredSketches | null;
    store = parsed && Array.isArray(parsed.sketches)
      ? parsed
      : { sketches: [], openId: null };
  } catch {
    store = { sketches: [], openId: null };
  }

  const index = store.sketches.findIndex((sketch) => sketch.id === sketchId);
  if (index < 0) return null;

  const updated = { ...mutate(store.sketches[index]), updatedAt: Date.now() };
  store.sketches[index] = updated;
  const payload = JSON.stringify(store);
  await setProjectItem(SKETCH_STORAGE_KEY, payload);
  window.dispatchEvent(new StorageEvent("storage", {
    key: SKETCH_STORAGE_KEY,
    newValue: payload,
  }));
  return updated;
}