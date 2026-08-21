// Universal project store. Selain melacak hydration, store ini juga menampung
// clipboard antar-halaman/level (mis. area parkir) supaya copy/paste tidak
// hilang saat berpindah level atau komponen di-unmount.

import { create } from "zustand";
import { hydrateFromIndexedDB, setStorageOwner } from "@/lib/storage/idb-bridge";
import type { ParkingArea } from "@/lib/parking";

type ProjectStore = {
  hydrated: boolean;
  hydrating: boolean;
  error: string | null;
  ownerId: string | null;
  hydrate: (ownerId?: string | null) => Promise<void>;
  // Clipboard area parkir (tanpa levelId — diisi saat paste).
  parkingClipboard: ParkingArea[] | null;
  setParkingClipboard: (areas: ParkingArea[] | null) => void;
};

export const useProjectStore = create<ProjectStore>((set, get) => ({
  hydrated: false,
  hydrating: false,
  error: null,
  ownerId: null,
  hydrate: async (ownerId = null) => {
    const s = get();
    if (s.hydrating) return;
    if (s.hydrated && s.ownerId === ownerId) return;
    set({ hydrating: true, error: null, hydrated: false, ownerId });
    try {
      await setStorageOwner(ownerId);
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
