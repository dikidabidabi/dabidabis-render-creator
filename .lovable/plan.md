# Fitur Ramp di Sketsa

Sebelum saya implementasi, mohon konfirmasi rencana berikut karena ini fitur cukup besar dan menyentuh banyak bagian aplikasi sketsa.

## Model data

File baru `src/lib/ramps.ts`:

```ts
type RampAnchor = { x: number; y: number; filletR?: number; };
type Ramp = {
  id: string;
  levelId: string;            // level penggambaran (kaki ramp)
  upperLevelId?: string;      // dihitung dari levels sortir (level di atas)
  anchors: RampAnchor[];      // polyline acuan sisi 1 (≥2 titik)
  offsetSide: "left" | "right"; // sisi 1 m offset
  widthM: number;             // default 1
  nM: number;                 // panjang acuan kemiringan, default 7
  // tM (tinggi) otomatis = mdpl(upper) − mdpl(level)
};
```

Disimpan di `Sketch.ramps?: Ramp[]`. Rescale skala mengikuti pola elemen lain (px = m × pxPerMeter).

## Toolbar

Tombol baru "Ramp" di toolbar utama. Sub-toolbar muncul saat aktif:

- **Tarik** — klik berurutan untuk titik acuan; Enter / double-click selesai. Sisi offset otomatis menghadap sisi yang berlawanan dengan arah klik pertama→kedua (default kanan terhadap arah jalan; bisa di-flip dengan tombol).
- **Edit**:
  - **Lebar** — input numerik meter (mengubah `widthM`).
  - **Kemiringan** — tampil "1:" + input untuk `n` (m). `t` ditampilkan read-only = beda MDPL ke level atas.
  - **Fillet** — input radius (m); klik titik internal polyline acuan untuk menerapkan radius (`filletR`).
  - **Geser** — drag titik awal/akhir polyline acuan.
  - **Tambah titik** — klik di sepanjang polyline acuan untuk menyisipkan vertex baru (untuk belokan).

## Geometri & rendering

Diturunkan saat render dari `anchors`:

1. Polyline acuan (sisi 1) → di-fillet pada vertex internal yang punya `filletR` (sudut difillet menjadi busur tangensial).
2. Polyline offset = offset paralel `widthM` ke `offsetSide`. Jika acuan difillet (sudut dalam), busur sisi luar membesar sebesar `r + widthM`; jika sudut luar, busur sisi luar mengecil → konsisten dengan permintaan.
3. Total panjang ramp = panjang polyline acuan; titik tengah (di panjang/2) menjadi lokasi garis pembatas. Pembatas 45° terhadap sumbu acuan lokal pada titik tengah, menghubungkan kedua tepi (acuan & offset).
4. Pada `levelId` (level penggambaran): separuh dari kaki sampai pembatas = garis solid; separuh dari pembatas sampai puncak = garis putus-putus.
5. Pada `upperLevelId` (level di atas): kebalikannya — separuh atas solid, separuh bawah putus-putus.
6. Pada level lain: tidak digambar.

## Notasi arah ramp

Dua garis dari kedua sudut sisi acuan awal (titik 0 acuan dan titik 0 offset) bertemu di "puncak ramp" — titik di tengah jalur pada akhir polyline (rata-rata titik akhir acuan & offset). Digambar di atas tubuh ramp di kedua level (mengikuti polanya: solid di kaki, dashed di atas).

## Edit yang interaktif

- **Geser**: handle bulat di titik awal & akhir; drag dengan snap aktif.
- **Tambah titik**: klik pada segmen polyline acuan → vertex baru tepat di proyeksi titik klik di segmen.
- **Fillet**: klik vertex internal → prompt / pakai nilai input aktif untuk `filletR`.

## File yang diubah

- **Baru**: `src/lib/ramps.ts` (tipe + helper offset/fillet/length/midpoint).
- `src/routes/sketch.tsx`:
  - Tambah `ramps?: Ramp[]` ke `Sketch`.
  - Tambah union "ramp" ke state `tool`, plus state `rampSub`, `rampDraft`, `rampSelectedId`, `rampWidthInput`, `rampNInput`, `rampFilletInput`.
  - Tombol toolbar + sub-toolbar.
  - Click/move/up handler untuk Tarik & sub-Edit.
  - Render pass baru `drawRamps(ctx, sketch, activeLevel, levels)`.
  - Rescale ramps saat skala berubah.
- Halaman lain (presentasi, model3d) **tidak diubah** dalam plan ini (cakupan terbatas ke sketsa).

## Hal yang **tidak** termasuk

- Tidak mengubah model 3D / extrude ramp di `model3d.tsx`.
- Tidak menampilkan ramp di slide denah `presentasi.tsx`.
- Tidak ada perhitungan tabulasi luas ramp.

Mohon konfirmasi atau beri tahu apa yang perlu diubah/ditambah sebelum saya implementasi.