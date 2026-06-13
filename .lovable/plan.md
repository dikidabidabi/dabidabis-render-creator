
# Rombak Arsitektur State Management: Universal Store + IndexedDB

Tujuan: pindahkan semua state proyek (Sketsa, Narasi, Tabulasi, Pengaturan) dari `localStorage` per-halaman ke satu Global Store berbasis Zustand yang dipersist ke IndexedDB via `localforage`, dengan auto-save debounced dan re-hydration penuh sebelum UI dirender.

## 1. Dependensi baru
- `bun add zustand localforage`

## 2. File baru

### `src/lib/storage/idb.ts`
Wrapper `localforage` (driver: IndexedDB) dengan key `dabidabis_project_v1`. Expose `get/set/remove`.

### `src/lib/storage/migrate-localstorage.ts`
Migrasi satu kali: baca seluruh key `dabidabis_*` dari `localStorage` (sketsa, narasi, perspektif, tabulasi, model3d, presentasi, pengaturan), bentuk objek `ProjectState`, tulis ke IndexedDB, lalu tandai `dabidabis_migrated_v1=1`. Tidak menghapus `localStorage` (sebagai fallback) pada putaran pertama.

### `src/store/project-store.ts`
Zustand store tunggal:
```ts
type ProjectState = {
  hydrated: boolean;
  canvasData: SketchStore;       // titik/garis/poligon/parkir/lahan/layers
  narrativeData: NarasiStore;    // teks + gambar narasi
  perspektifData: PerspektifStore;
  tabulationData: TabulasiStore; // luasan, parkir, KLB/KDB
  projectSettings: {
    geo: Geo;
    northRotation: number;
    subLayerCoeff: Record<string, number>;
    // dll
  };
  model3dData: Model3dStore;
  presentasiData: PresentasiStore;

  // actions
  setCanvas(updater): void;
  setNarrative(updater): void;
  // ...
  hydrate(): Promise<void>;
};
```
Middleware: `persist` dengan storage adapter custom yang menulis ke IndexedDB via `localforage` (bukan localStorage). Debounce 1 detik di sisi `setItem` adapter agar tidak menulis tiap keystroke.

### `src/store/persist-idb.ts`
Adapter `StateStorage` untuk Zustand `persist` yang membungkus `localforage` + debounce 1000ms via `setTimeout`. `getItem` async, `setItem` debounced, `removeItem` immediate.

### `src/components/project-hydration-gate.tsx`
Komponen pembungkus: panggil `useProjectStore.getState().hydrate()` di `useEffect`, render `<Loader>` selama `!hydrated`, baru render `children`. Dipakai di `src/routes/__root.tsx` membungkus `<Outlet />`.

## 3. Refactor halaman
Pola umum untuk setiap halaman (`sketch.tsx`, `narasi.tsx`, `tabulasi.tsx`, `model3d.tsx`, `presentasi.tsx`):
- Ganti `useState` + `useEffect(load)` + `useEffect(save)` localStorage → `useProjectStore(s => s.xxx)` + `useProjectStore(s => s.setXxx)`.
- Hapus blok `loadXxx()` / `saveXxx()` dari masing-masing file (atau biarkan sebagai no-op fallback).
- Event `storage` listener cross-tab tetap (tapi sekarang via Zustand subscribe untuk reaktivitas).

Karena ukuran refactor besar, akan dilakukan bertahap per-modul (sketch → tabulasi → narasi → model3d → presentasi) dalam edit yang sama, mempertahankan API publik tiap komponen.

## 4. Migrasi data lama
Saat pertama kali `hydrate()` dijalankan, jika IndexedDB kosong dan ada data `dabidabis_*` di `localStorage`, panggil `migrate-localstorage.ts` lalu set flag. Pengguna yang sudah punya proyek tidak kehilangan data.

## 5. Auto-save
Sudah inherent: setiap mutasi store memicu Zustand `persist` adapter → debounce 1 detik → tulis IndexedDB. Tidak perlu tombol Save.

## 6. Re-hydration
`ProjectHydrationGate` di root: blokir render route sampai `hydrated=true`. Saat hydrate selesai, semua halaman membaca state penuh dari store dan langsung tersedia.

## 7. Catatan teknis
- IndexedDB tidak ada batas 5MB; localforage default 50MB+ tergantung browser.
- Field gambar besar (base64 perspektif, dsb.) sekarang aman di IndexedDB.
- File `workspace-sync.ts` (backup/restore) diperbarui agar `collectWorkspace` membaca dari IndexedDB dan `restoreWorkspace` menulis ke IndexedDB + memicu `useProjectStore.setState`.
- Tidak mengubah perilaku UI, tidak mengubah skema data, tidak mengubah file Supabase.

## 8. Risiko & mitigasi
- File halaman besar (`sketch.tsx`, `presentasi.tsx`) → refactor minimal-invasive: pertahankan tipe & nama variabel, hanya ganti sumber state.
- Hydration async → semua route menunggu di gate; route loader yang membaca localStorage langsung diganti membaca dari store/IDB.

Setelah approval, saya mulai dengan: install deps → buat store + adapter + gate → migrasi → refactor halaman satu per satu.
