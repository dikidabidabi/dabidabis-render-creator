// Universal project store. Selain melacak hydration, store ini juga menampung
// clipboard antar-halaman/level (mis. area parkir) supaya copy/paste tidak
// hilang saat berpindah level atau komponen di-unmount.

import { create } from "zustand";
import { hydrateFromIndexedDB } from "@/lib/storage/idb-bridge";
import type { ParkingArea } from "@/lib/parking";

type ProjectStore = {
  hydrated: boolean;
  hydrating: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  // Clipboard area parkir (tanpa levelId — diisi saat paste).
  parkingClipboard: ParkingArea[] | null;
  setParkingClipboard: (areas: ParkingArea[] | null) => void;
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
  parkingClipboard: null,
  setParkingClipboard: (areas) => set({ parkingClipboard: areas }),
}));
