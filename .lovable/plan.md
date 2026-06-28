# Rencana: Master Plan = Kanvas Sketsa (kecuali Cluster Generator)

Halaman Sketsa (~12.5k baris) berisi semua perilaku yang diminta. Membuat tiruannya manual di `masterplan.tsx` berisiko desinkronisasi besar (sudah terjadi pada iterasi pertama). Pendekatan paling akurat dan mudah dirawat:

## Strategi: Reuse `SketchPage` lewat mode `masterplan`

1. **Refaktor ringan `src/routes/sketch.tsx`** — ekstrak body komponen menjadi `SketchCanvas({ mode })` dengan dua nilai:
   - `mode="sketch"` (default) — perilaku saat ini, tidak berubah.
   - `mode="masterplan"` — penyimpanan dialihkan ke storage Master Plan, panel kiri menampilkan KDB/KLB/KDH + Luas Lahan + ringkasan GFA per fungsi, tombol "Cluster Generator" memunculkan `masterplan-cluster-dialog` (bukan `cluster-generator-dialog` versi sketsa).
   - File `src/routes/sketch.tsx` tetap mengekspor route `/sketsa` yang merender `<SketchCanvas mode="sketch" />`.

2. **`src/routes/masterplan.tsx` dipangkas** menjadi route tipis yang merender `<SketchCanvas mode="masterplan" />`. Hasilnya: semua tool kanan (Garis, Persegi, Skala, Koordinat, Rotasi, Edit Titik, Move, Mirror, Trim, Extend, Snap, Utara, Undo/Redo, **plus** Layer/Lantai/Pintu/Parkir/Grid Struktur/Ramp/Separasi/Section/Floor/Door — semua sub-tool ikut karena memang komponen yang sama), gesture pinch-zoom + two-finger rotate, dan tombol fullscreen identik dengan halaman Sketsa.

3. **Beda perilaku Master Plan:**
   - Setiap "ruang" yang digambar disimpan juga sebagai `MassFootprint` di `dabidabis-masterplan-v1` dengan `height`/`floors` default 12 m / 3 lantai (Komersial), dapat diubah dari panel layer (input tinggi tambahan, tanpa batas).
   - Tombol "Cluster Generator" memanggil `masterplan-cluster-dialog` (sudah memenuhi spek konteks tapak: gate, hierarki, skyline). Output polygon dimasukkan sebagai layer baru di kanvas.
   - Tool "Cluster Generator" versi Sketsa disembunyikan di mode `masterplan`.

4. **Migrasi data:** layer Master Plan lama (rect `{x,z,w,d}`) dikonversi ke polygon 4-titik saat di-load; data Sketsa yang ada tidak tersentuh karena storage berbeda.

## Catatan teknis

- Refaktor `sketch.tsx` dilakukan dengan menggeser tubuh fungsi route ke komponen `SketchCanvas` dan menambahkan parameter `mode`; signature props minimal, sisa state internal tidak berubah. Risiko regresi rendah selama hanya cabang berbasis `mode` yang ditambah.
- Storage key dialihkan via konstanta `STORAGE_KEY = mode === "masterplan" ? "dabidabis-masterplan-canvas-v1" : "dabidabis-sketch-v1"`. Snapshot Master Plan lama (polygon massa) tetap dibaca untuk migrasi awal.
- Tipe `MassFootprint` di `src/lib/masterplan.ts` tetap; sinkronisasi 2 arah (layer ↔ MassFootprint) dijalankan dari mode masterplan.

## Validasi

- `tsgo` lulus.
- Manual: di `/masterplan`, pinch-zoom + rotate dua jari + fullscreen bekerja sama persis dengan `/sketsa`; semua sub-tool kanan tersedia dengan sub-mode yang sama; tombol Cluster Generator membuka dialog Master Plan; KDB/KLB/KDH terhitung dari polygon lahan.

## Estimasi ukuran perubahan

- `src/routes/sketch.tsx`: +~150 baris (ekstraksi komponen + cabang mode).
- `src/routes/masterplan.tsx`: rewrite menjadi ~40 baris (wrapper).
- `src/lib/masterplan.ts`: kecil — helper konversi layer↔MassFootprint.

Mohon konfirmasi sebelum saya eksekusi — ini menyentuh `sketch.tsx` yang besar.
