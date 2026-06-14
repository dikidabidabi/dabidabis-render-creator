# Generator Lot Parkir Otomatis di Kanvas Sketsa 2D

Fitur baru murni geometris (tanpa AI) untuk menjejalkan deret parkir mobil ke dalam area yang ditarik pengguna, otomatis mengikuti orientasi grid struktural, dan otomatis menghapus unit yang menabrak kolom/dinding. Hasil terhubung reaktif ke Tabulasi per-level.

## 1. Parameter baku
Konstanta di file baru `src/lib/parking.ts`:
- `STALL_W = 2.5 m`, `STALL_L = 5.0 m` (tegak lurus 90°)
- `AISLE_W = 5.5 m` (dua arah)
- `MODULE = 5 + 5.5 + 5 = 15.5 m` (double-loaded), fallback `10.5 m` (single-loaded jika tarikan sempit)

## 2. Data model
Tambah field di `Sketch`:
```ts
parkingAreas?: ParkingArea[];
```
```ts
type ParkingArea = {
  id: string;
  levelId?: string;
  // Bounding box dalam koordinat LOKAL grid (meter, relatif grid.origin, ter-rotasi
  // sesuai grid.rotation). Disimpan lokal supaya tetap nempel ke grid kalau grid
  // diputar/digeser.
  rectLocal: { x: number; y: number; w: number; h: number };
  // Orientasi deret: 'auto' (ikut sisi terpanjang), 'x', atau 'y'.
  orientation?: "auto" | "x" | "y";
  // Override manual (opsional) — user bisa hapus stall tertentu.
  disabled?: string[]; // key "row,col"
};
```
File baru `src/lib/parking.ts` berisi `normalizeParkingArea(s)`, generator stall, dan tipe `ParkingStall`.

## 3. Tool baru `parking`
Tambah `"parking"` ke union `tool` di `sketch.tsx` + tombol di toolbar (ikon mobil).
Gestur: drag dua titik → bounding box di koordinat dunia → dikonversi ke koordinat lokal grid (memakai `grid.origin` + `grid.rotation` aktif pada level). Jika tidak ada grid aktif, fallback orientasi = sumbu kanvas (rotation 0). Sisi penataan stall dipilih otomatis (sisi terpanjang = arah deret), bisa di-toggle X/Y via tombol kecil setelah selesai menarik.

## 4. Algoritma packing (`src/lib/parking.ts`)
Fungsi `generateStalls(area, grid, levelId): ParkingStall[]`:
1. Tentukan sumbu deret (D = panjang area sepanjang orientasi, A = lebar tegak lurus).
2. Bagi lebar A menjadi modul: jika `A ≥ 15.5` pakai double-loaded berulang, sisa `<15.5 && ≥ 5` pakai single-loaded (satu baris tanpa aisle di tepi).
3. Untuk setiap baris (panjang `5 m` tegak lurus aisle), looping stall `2.5 m` dari ujung ke ujung; jumlah stall = `floor(D / 2.5)`, sisa kiri-kanan dibagi sebagai buffer.
4. Output: array `ParkingStall { id, polygonLocal: [4 titik meter lokal grid], rowIdx, colIdx, isValid }`.

Konversi ke dunia: `localToWorld(pt, grid)` (rotasi + translasi origin + skala m→px memakai `mPerPx` dari proyek).

## 5. Collision avoidance (Turf.js)
- `bun add @turf/turf`
- Untuk tiap stall, bangun `turf.polygon` di koordinat meter dunia.
- Kumpulkan obstacle dari sketch level aktif:
  - Garis dinding → `turf.lineString` dengan buffer kecil (½ tebal dinding atau 5 cm) → polygon.
  - Kolom struktural → `turf.polygon` dari kotak `colSizeCm` di tiap node visible (memakai `isColumnVisible` dari `structural-grid.ts`).
- `isValid = !turf.booleanIntersects(stallPoly, obstaclePoly)` untuk semua obstacle.
- Stall invalid dihapus dari render (slot dibiarkan kosong sebagai buffer sirkulasi).

## 6. Render di kanvas
Di blok render kanvas `sketch.tsx`, setelah menggambar grid/dinding, sebelum overlay teks: untuk tiap `parkingAreas` pada level aktif, gambar:
- Outline area parkir (garis dash tipis).
- Tiap stall valid: rectangle dengan stroke `#0ea5e9` 1.2 px (light) / dash mark T pada hood, no fill.
Re-generate stall hanya saat: area berubah, grid berubah, atau garis/kolom level berubah (memoize via `useMemo` dengan deps spesifik). Saat user sedang drag bbox baru, jalankan preview dengan `requestAnimationFrame` throttling agar tetap 60 fps.

## 7. Multi-area per level
`parkingAreas` adalah array — user bisa menarik beberapa bbox pada level yang sama. Setiap area independen; total kapasitas level = `Σ stalls.isValid` semua area level itu.

## 8. Tabulasi reaktif
Di `src/routes/tabulasi.tsx` tambah baris/kartu "Kapasitas Parkir" per level + total proyek:
- Hitung `totalStalls = Σ valid stalls` dari `sketch.parkingAreas` semua level.
- "Rasio Efisiensi Parkir" = `(totalStalls × 12.5 m²) / Σ luas bbox area parkir × 100 %`.
- Reaktif otomatis karena bersumber dari state Sketch yang dipersist via store global → IndexedDB.

## 9. Performa
- Packing & collision dijalankan dalam `useMemo` dengan key (`areaId + grid hash + obstacles hash`).
- Saat drag preview, hanya area sementara yang dihitung; obstacles diindeks sekali ke `turf.featureCollection` per level (memo).
- Tidak menyentuh model3d (parkir murni 2D notasi).

## 10. File yang disentuh
- Baru: `src/lib/parking.ts`
- Edit: `src/routes/sketch.tsx` (tipe Sketch, tool `parking`, toolbar, render, drag-handler, normalisasi muat/simpan)
- Edit: `src/routes/tabulasi.tsx` (kartu kapasitas + rasio parkir)
- Edit: `package.json` (dep `@turf/turf`)

Setelah approval, saya mulai: install Turf → buat `parking.ts` → patch `sketch.tsx` (tool + render + persist) → patch `tabulasi.tsx`.
