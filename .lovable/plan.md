
## Tujuan
Menambahkan **Modul Struktur** (parametric Structural Grid) yang terhubung dari sketsa 2D → model 3D → tabulasi → presentasi.

## Model Data Baru

Tambahkan field `structuralGrid` ke tipe `Sketch`:

```ts
type StructuralGrid = {
  enabled: boolean;
  origin: { x: number; y: number };   // titik awal grid di koordinat kanvas (px world)
  spansX: number[];                    // bentang per kolom sumbu X (meter)
  spansY: number[];                    // bentang per baris sumbu Y (meter)
  colSizeCm: number;                   // dimensi kolom persegi (cm), mis. 50
  rotation: number;                    // derajat
  levelRange: { fromLevelId: string; toLevelId: string };  // berlaku dari level..ke level
  // Per-level override (copy & edit untuk hapus kolom tertentu)
  perLevel?: Record<string, {
    disabledNodes?: string[];          // node key "i,j" yang dihilangkan di level itu
    spansX?: number[];                 // override bentang (opsional)
    spansY?: number[];
  }>;
};
```

Default bentang preset: 6, 7.2, 8, 9 m. Default kolom: 40, 50, 60, 70, 80 cm.

## 1. UI Panel (src/routes/sketch.tsx)

Tambah section **"Modul Struktur"** di sidebar kanan (dekat panel KDB/KLB):
- Toggle aktif/non-aktif
- Preset bentang chips (6 / 7.2 / 8 / 9 m) + custom input untuk X & Y
- Daftar bentang per as (table editable): tambah/hapus/ubah tiap bentang individual → menghasilkan **bentang unik**
- Dimensi kolom (cm): preset chips + numeric input
- Range level berlaku: dropdown "Dari level" → "Sampai level"
- Tombol **"Copy ke level aktif"** + ikon hapus node (klik kolom di canvas saat tool aktif untuk toggle disable per level)
- Tombol reset origin (drag origin di canvas saat tool aktif)

## 2. Render Grid di Kanvas 2D

Di renderer canvas sketch (drawScene), saat `grid.enabled` dan level aktif termasuk range:
- Hitung posisi as kumulatif dari `spansX`/`spansY` (meter → px via `mPerPx`)
- Garis as: **dash-dot** pattern `[8, 4, 1.5, 4]`, 0.8 px, warna `#222`
- Bubbles: lingkaran Ø ~24 px di tiap ujung garis, stroke hitam tipis, label angka (1,2,3) untuk X dan huruf (A,B,C) untuk Y, font kecil
- Kolom: persegi padat hitam berukuran `colSizeCm` di setiap titik potong (center on intersection); skip node jika ada di `perLevel[active].disabledNodes`
- Interaksi: klik node → toggle disable (mode "Edit Grid"); drag bubble → ubah `spans[i]` (geser as → bentang unik)

## 3. Model 3D (src/routes/model3d.tsx)

Tambah `<StructuralColumns>` yang membaca `sketch.structuralGrid` + per-level overrides:
- Untuk setiap level dalam range, kumpulkan node aktif
- Hitung tinggi kolom = `tipicalHeightOf(level) × (typicalCount ?? 1)` (atau gap MDPL ke level berikutnya)
- Ekstrusi BoxGeometry (colSize × height × colSize) di posisi (x, baseMdpl, z) menggunakan helper proyeksi sama dengan ExtrudedFloor
- Warna kolom: `#111` (hampir hitam), shading standar

## 4. Tabulasi & Statistik (src/routes/sketch.tsx + tabulasi.tsx + presentasi.tsx)

Tambah computed stats:
- `totalColumns`: jumlah kolom efektif (sum semua level dalam range, dikurangi disabled, dikali typicalCount)
- `concreteVolumeM3`: Σ (colArea × height) per kolom
- Inject ke `Stats` di `tabulasi.tsx` dan `presentasi.tsx` (RekapBody) sebagai dua KPI baru: **Total Kolom** dan **Volume Beton (m³)**.

## 5. Render Grid di Slide Presentasi (src/routes/presentasi.tsx)

Di `LevelBody` (denah slide) dan `StackingBody`:
- Render grid lines lebih **tipis** dari garis potong (stroke 0.4 px, dash-dot)
- Bubbles & label warna hitam dengan stroke setipis grid
- Kolom: persegi padat hitam (sama colSize)
- Di `AxonometricView` & `StackingBody`: render kolom 3D hitam tipis di tumpukan level (sesuai range)

## 6. Logika Kunci

```text
posX[0] = origin.x
posX[i] = posX[i-1] + spansX[i-1] (m) × pxPerM
nodes[i,j] = (posX[i], posY[j])
key = `${i},${j}`
active(i,j, levelId) = !perLevel[levelId]?.disabledNodes.includes(key)
```

Edit grid (geser as ke‑i): saat user drag bubble X ke‑i, update `spansX[i-1]` dan `spansX[i]` berdasarkan delta — hasilkan bentang unik tanpa menggeser as lain.

Copy grid ke level: salin `spans` saat ini ke `perLevel[levelId]` lalu boleh edit independen.

## File yang Diubah
- `src/routes/sketch.tsx` — tipe + UI panel + render canvas + interaksi
- `src/routes/model3d.tsx` — ekstrusi kolom 3D
- `src/routes/tabulasi.tsx` — stats kolom & volume beton
- `src/routes/presentasi.tsx` — render grid di slide denah, stacking, infografis (KPI kolom & beton)

## Catatan
Akan menambah cukup banyak kode tetapi semua frontend/presentasi — tanpa backend changes.
