# Rencana: Halaman Master Plan Berbasis Sketsa 2D

## Tujuan
Mengganti `src/routes/masterplan.tsx` dari kanvas 3D Three.js menjadi kanvas 2D dengan **milimeter block grid** mirip halaman Sketsa. Pengguna menggambar **footprint massa bangunan** di tapak, lalu Cluster Generator menentukan **ketinggian** tiap massa.

## Arsitektur (penting)

Berbagi kode dengan `src/routes/sketch.tsx` (12.5k baris) tidak realistis untuk dilakukan dalam satu iterasi tanpa refaktor mendalam yang berisiko merusak Sketsa. Saya akan menempuh jalur **ekstraksi terkontrol**:

1. **Ekstrak engine kanvas 2D minimal** ke `src/lib/canvas2d/` (geometry + state inti), tanpa mengubah perilaku Sketsa:
   - Tipe bersama: `Vec2`, `Polygon`, `LayerShape`, riwayat undo/redo.
   - Util grid milimeter, snap, pan/zoom, koordinat dunia↔layar.
   - Operasi: line draw, rect draw, edit titik, move, rotate, mirror, trim-extend, koordinat manual.
   Kode ini diturunkan dari pola di `sketch.tsx` tetapi dijaga ringkas (~1-1.5k baris), tidak menyentuh fitur lain (ramp, floor, separasi, doors, parking, struktur grid, dsb).

2. **Halaman Master Plan baru** (`src/routes/masterplan.tsx`, ~600-900 baris):
   - Header dengan skala (1:200…1:2000) sama seperti Sketsa.
   - Panel kiri: **KDB / KLB / KDH / Luas Lahan** (copy persis perilaku dari Sketsa) + ringkasan GFA per fungsi (Komersial/Fasum/RTH).
   - Kanvas tengah: grid milimeter block, polygon "Lahan" otomatis (dapat diedit), gambar massa sebagai polygon "lantai dasar" berwarna fungsi.
   - Panel kanan toolbar: Garis, Persegi, Skala, Input Koordinat, Rotasi, Edit Titik, Move, Mirror, Trim-Extend, Snap, Arah Utara, Undo, Redo (sub-fitur sama dengan Sketsa).
   - Tombol **Cluster Generator** memunculkan dialog yang sudah ada (`masterplan-cluster-dialog.tsx`) — perilaku dipertahankan; output kini berupa massa 2D dengan tinggi tersimpan.

3. **Model massa**:
   - Tipe baru `MassFootprint { id, name, fn, polygon: Vec2[], height, floors }` di `src/lib/masterplan.ts`.
   - Penyimpanan tetap `localStorage` key `dabidabis-masterplan-v1` (migrasi otomatis: blok lama `{x,z,w,d}` dikonversi ke polygon segiempat).
   - Visual di kanvas 2D = lantai dasar (fill + edges); tinggi disimpan sebagai properti, **tidak dibatasi keterangan tinggi di layer** (tidak ada batas atas, hanya nilai numerik).
   - Cluster Generator menyetel `height` sesuai kebutuhan (Volume ÷ Luas) lalu mengisikan ke kanvas sebagai polygon persegi atau hasil tata-letak.

4. **Slide Presentasi Master Plan**: tetap berfungsi — adaptasi pembaca data agar mendukung polygon (sederhana: jika ada polygon, render polygon; jika tidak, fallback rect).

## Apa yang TIDAK termasuk
- Fitur Sketsa lain (ramp, separasi ruang, doors, parking, structural grid, floor arc/bezier, sections) — tidak diport ke Master Plan.
- Refaktor besar `sketch.tsx` itu sendiri — perilaku Sketsa dijaga tidak berubah.
- Render 3D — Master Plan menjadi murni 2D. Skyline 3D dialihkan ke halaman `/model3d` jika dibutuhkan kemudian.

## Detail Teknis Singkat

```text
src/lib/canvas2d/
  types.ts         // Vec2, LayerShape, History<T>
  grid.ts          // mm-grid render, world<->screen
  snap.ts          // endpoint/mid/grid snap
  ops.ts           // move/rotate/mirror/trim-extend/editVertex
  history.ts       // undo/redo stack
src/lib/masterplan.ts
  + MassFootprint, migrasi, polygonArea, totalsByFunction(polygon-aware)
src/routes/masterplan.tsx
  // rewrite total: kanvas 2D + panel kiri KDB/KLB/KDH + toolbar kanan
src/components/masterplan-cluster-dialog.tsx
  // onCommit kini mengembalikan MassFootprint[] (rect polygon + height)
```

## Validasi
- `tsgo` lulus tanpa error tipe baru.
- Manual: gambar persegi → muncul sebagai lantai dasar berwarna; Cluster Generator → menambahkan beberapa massa dengan tinggi sesuai input; KDB/KLB terhitung otomatis dari polygon; undo/redo, move, mirror, rotate berfungsi.

## Estimasi Skala
~3 file baru di `src/lib/canvas2d/`, rewrite `masterplan.tsx`, update tipe di `masterplan.ts`, sedikit penyesuaian di `masterplan-cluster-dialog.tsx` dan bagian Master Plan di `presentasi.tsx`. Total ±2.500 baris baru.
