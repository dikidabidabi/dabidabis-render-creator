// Pustaka Prompt — koleksi prompt & gaya arsitektur yang disimpan pengguna dari
// node "Prompt & Style" di halaman Studio. Disimpan dengan prefix dabidabis_
// sehingga otomatis privat per akun (lihat src/lib/storage/idb-bridge.ts).

export const PROMPT_LIBRARY_KEY = "dabidabis_prompt_library_v1";

export type PromptLibraryEntry = {
  id: string;
  no: number;
  name: string;
  style: string;
  detail: string;
  geometryConsistency: number;
  sampleImage: string | null;
  createdAt: number;
};

export function loadPromptLibrary(): PromptLibraryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PROMPT_LIBRARY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return (arr as PromptLibraryEntry[])
      .filter((e) => e && typeof e.id === "string")
      .sort((a, b) => a.no - b.no);
  } catch {
    return [];
  }
}

function persist(list: PromptLibraryEntry[]) {
  try {
    localStorage.setItem(PROMPT_LIBRARY_KEY, JSON.stringify(list));
  } catch {
    // Kuota penuh — coba simpan tanpa gambar contoh.
    try {
      localStorage.setItem(
        PROMPT_LIBRARY_KEY,
        JSON.stringify(list.map((e) => ({ ...e, sampleImage: null }))),
      );
    } catch {
      /* ignore */
    }
  }
}

export function savePromptToLibrary(entry: {
  style: string;
  detail: string;
  geometryConsistency?: number;
  sampleImage?: string | null;
  name?: string;
}): PromptLibraryEntry {
  const list = loadPromptLibrary();
  const no = list.reduce((m, e) => Math.max(m, e.no), 0) + 1;
  const created: PromptLibraryEntry = {
    id: `prompt-lib-${crypto.randomUUID().slice(0, 8)}`,
    no,
    name: entry.name?.trim() || `Prompt #${no}`,
    style: entry.style ?? "",
    detail: entry.detail ?? "",
    geometryConsistency: entry.geometryConsistency ?? 70,
    sampleImage: entry.sampleImage ?? null,
    createdAt: Date.now(),
  };
  persist([...list, created]);
  return created;
}

export function removePromptFromLibrary(id: string) {
  persist(loadPromptLibrary().filter((e) => e.id !== id));
}

export function renamePromptInLibrary(id: string, name: string) {
  persist(loadPromptLibrary().map((e) => (e.id === id ? { ...e, name } : e)));
}
