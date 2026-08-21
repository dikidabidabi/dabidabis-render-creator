// Universal project store. Selain melacak hydration, store ini juga menampung
// clipboard antar-halaman/level (mis. area parkir) supaya copy/paste tidak
// hilang saat berpindah level atau komponen di-unmount.
//
// Data proyek bersifat privat per akun: hydration selalu terikat pada pemilik
// (owner) yaitu user id akun yang sedang masuk.

import { create } from "zustand";
import { GUEST_OWNER, hydrateFromIndexedDB } from "@/lib/storage/idb-bridge";
import type { ParkingArea } from "@/lib/parking";

type ProjectStore = {
  hydrated: boolean;
  hydrating: boolean;
  owner: string | null;
  error: string | null;
  hydrate: (owner?: string) => Promise<void>;
  // Clipboard area parkir (tanpa levelId — diisi saat paste).
  parkingClipboard: ParkingArea[] | null;
  setParkingClipboard: (areas: ParkingArea[] | null) => void;
};

export const useProjectStore = create<ProjectStore>((set, get) => ({
  hydrated: false,
  hydrating: false,
  owner: null,
  error: null,
  hydrate: async (owner = GUEST_OWNER) => {
    const s = get();
    if (s.hydrating && s.owner === owner) return;
    if (s.hydrated && s.owner === owner) return;
    set({ hydrating: true, hydrated: false, owner, error: null });
    try {
      await hydrateFromIndexedDB(owner);
      if (get().owner !== owner) return;
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
