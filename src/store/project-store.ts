// Universal project store. The actual project data still lives in the
// `dabidabis_*` localStorage keys consumed by each page, but those keys are
// transparently backed by IndexedDB via `src/lib/storage/idb-bridge.ts`.
//
// This Zustand store tracks the hydration lifecycle so the UI can wait for
// IndexedDB to repopulate the in-memory cache before any page component
// mounts and tries to read its slice of state.

import { create } from "zustand";
import { hydrateFromIndexedDB } from "@/lib/storage/idb-bridge";

type ProjectStore = {
  hydrated: boolean;
  hydrating: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
};

export const useProjectStore = create<ProjectStore>((set, get) => ({
  hydrated: false,
  hydrating: false,
  error: null,
  hydrate: async () => {
    if (get().hydrated || get().hydrating) return;
    set({ hydrating: true, error: null });
    try {
      await hydrateFromIndexedDB();
      set({ hydrated: true, hydrating: false });
    } catch (e) {
      set({
        hydrating: false,
        error: e instanceof Error ? e.message : "Gagal memuat data proyek",
      });
    }
  },
}));
