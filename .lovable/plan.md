# Rombak Fitur Parkir

Saat ini area parkir disimpan sebagai bounding box dunia (`center` + `halfW/halfH` + `rotation`) dan packing meninggalkan sel kosong setiap kali ketemu kolom/dinding. Permintaan baru menuntut: anchoring ke mm-grid, packing yang menggeser bukan melewatkan, edit titik polygon, rotasi, dan copy/paste antar-level.

## 1. Anchor ke mm-grid (skala & rotasi terkunci)

Ubah model `ParkingArea` di `src/lib/parking.ts`:

```ts
type ParkingArea = {
  id: string;
  levelId?: string;
  // Polygon di KOORDINAT LOKAL mm-grid (px-equivalent, sebelum rotasi/translasi grid).
  // Default saat menggambar drag = 4 titik rect; bisa jadi N-gon setelah edit titik.
  pointsLocal: { x: number; y: number }[];
  orientation?: "auto" | "x" | "y";
  // Rotasi tambahan stall relatif sumbu lokal grid (radian, default 0).
  stallRotation?: number;
  disabled?: string[];
};
```

Konversi local→world memakai `grid.origin` + `grid.rotation` mm-grid aktif (sama seperti sketsa lain). Karena disimpan dalam local-grid, saat grid digeser/diputar, area parkir ikut otomatis tanpa simpan ulang.

Saat menggambar (drag) dengan tool parking: titik pointer dikonversi ke local-grid lalu disimpan sebagai 4-titik rect lokal. Tidak ada lagi `center`/`halfW`/`halfH`/`rotation` dunia.

## 2. Packing "slide past obstacle" (tanpa skip 1 lot)

`generateStalls` di `src/lib/parking.ts` ditulis ulang:

1. Hitung polygon area di world (transform local→world).
2. Untuk tiap row (modul double/single, sama seperti sekarang), bentuk **strip** sepanjang sumbu deret dengan lebar `STALL_L`.
3. **Hitung interval valid sepanjang sumbu deret**: mulai dari rentang penuh `[0, D]`, kurangi dengan proyeksi setiap obstacle (kolom/dinding + buffer) ke sumbu deret, plus klip ke polygon area (untuk polygon non-rect, irisan strip × area).
4. Untuk tiap interval `[s, e]` hasil substraksi: pack stall berturut-turut dari `s` (offset 0, bukan center-buffer), `nStalls = floor((e-s)/STALL_W)`, sisa jadi buffer di ujung. Hasilnya stall menempel persis ke sisi obstacle berikutnya — tidak skip selot pun.
5. Stall yang dihasilkan otomatis valid (sudah dipotong di langkah 3), jadi tidak perlu cek `valid` per-stall lagi kecuali untuk area polygon non-konveks.

Ini juga otomatis benar untuk obstacle baru "ruang/polygon tertutup" — daftarkan polygon ruang (`sketch.floors`) sebagai obstacle, proyeksi ke sumbu deret = bayangan polygon.

## 3. Subtool "edit titik" dalam fitur parking

Di dalam toolbar parking munculkan sub-mode (state lokal `parkingSubTool`):

- **geser** — drag titik polygon area; klik & drag pada edge = drag seluruh area.
- **tambah titik** — klik pada edge menyisipkan titik baru di posisi terdekat.
- **hapus titik** — klik titik menghapusnya (min 3 titik).
- **rotasi kotak** — handle bulat di luar bbox; drag memutar `stallRotation` (rotasi stall di dalam area; area sendiri tetap mengikuti grid).

Semua interaksi di local-grid: titik pointer di-unproject ke local-grid sebelum diubah.

## 4. Copy / Paste / Hapus area parkir (antar-level)

State global di `src/store/project-store.ts`:

```ts
parkingClipboard: ParkingArea[] | null;  // tanpa levelId
copyParking(areas) / pasteParking(targetLevelId) / clearClipboard()
```

Toolbar parking sub-mode menambah tombol **Copy** (area terpilih), **Paste** (re-id + set `levelId` = level aktif, offset kecil agar tidak menumpuk), **Hapus**. Karena clipboard di store global, paste bisa di level berbeda.

Pemilihan area memakai klik biasa pada sub-tool "geser" (single-select untuk versi pertama; multi-select via Shift-klik).

## 5. UI & integrasi

- `src/routes/sketch.tsx`:
  - Sub-toolbar baru muncul saat `tool === "parking"` (mobile + desktop) berisi: Geser, +Titik, −Titik, Rotasi, Copy, Paste, Hapus.
  - Render handle titik & handle rotasi saat ada area terpilih.
  - Migrasi normalisasi: kalau load data lama yang punya `center/halfW/halfH`, konversi ke `pointsLocal` rect di local-grid aktif.
- `src/lib/parking.ts`: tambah `polygonToWorld(area, grid)`, `worldToLocal(p, grid)`, `localToWorld`. Tambah obstacle baru `floors` (polygon).
- `src/routes/tabulasi.tsx`: tidak berubah — tetap konsumsi `computeParkingStats`.

## Detail teknis

- Interval subtraction di sumbu deret memakai algoritma standar (sort intervals, sweep, kurangi). Obstacle yang miring diproyeksikan via min/max dot product titik-titiknya dengan vektor sumbu deret (plus padding setengah-`STALL_L` dari samping strip + buffer).
- `stallRotation ≠ 0` ditambahkan ke rotasi grid saat menghitung sumbu deret; obstacle juga ikut ditransform.
- Migrasi data lama dijalankan saat normalisasi `parkingAreas` jika `pointsLocal` tidak ada — pakai grid aktif level saat load.

## File yang berubah

- `src/lib/parking.ts` — rewrite model + packing.
- `src/routes/sketch.tsx` — sub-tool, handle UI, copy/paste, gambar polygon.
- `src/store/project-store.ts` — clipboard parkir.
