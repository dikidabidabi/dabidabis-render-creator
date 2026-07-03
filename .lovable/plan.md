# Fitur "Ilustrasi Analisa" pada Master Plan

Menambahkan set tool notasi analisa urban design (mengacu gambar Framework Diagram) yang digambar di kanvas halaman Master Plan dengan memanfaatkan sistem **garis** (lurus) dan **tangent** (kurva Catmull-Rom) yang sudah ada di `src/lib/axes.ts`. Hasilnya muncul otomatis sebagai slide baru **"Analisis Kawasan"** di halaman presentasi, hanya untuk sketsa yang terhubung (linked) dengan halaman Sketsa.

## Tool notasi (palet "Ilustrasi Analisa")

Semua notasi disimpan sebagai anotasi terpisah dari geometri bangunan/lahan/jalan (tidak mempengaruhi perhitungan luas, KDB, dll). Model data mirip `AxisSegment` — polyline dari garis atau kurva tangent, plus properti visual.

1. **Panah arah** (lurus / kurva) — garis atau tangent dengan arrowhead di ujung. Ketebalan & warna dipilih. Untuk panah masif abu-abu seperti referensi: preset "Panah Konteks".
2. **Zona area** — polygon isian (fill) semi-transparan berwarna (merah, biru, ungu, oranye, hijau) untuk menandai kluster fungsi. Menggunakan tangent tertutup atau garis tertutup.
3. **Alur / desire line** — garis putus-putus tebal (dash pattern) berwarna hijau/oranye/biru untuk jalur pedestrian, bus, atau kanal. Preset dash size.
4. **Node marker** — titik lingkaran + simbol asterisk di tengah (warna dipilih). Untuk "Key Nodal Space", "Pipeline Projects", dll.
5. **Access point** — lingkaran outline saja (tanpa isian), warna oranye default.
6. **Label callout** — teks + leader line (garis pendek) + titik jangkar. Untuk anotasi seperti "INTENSIFIED RESIDENTIAL...".
7. **Border dashed** — outline putus-putus (kontur area rencana) memakai tangent.

Setiap tool punya kontrol: **warna**, **ketebalan**, **opasitas**, **dash on/off**, **arrowhead on/off**, **label**.

## UI di halaman Master Plan

- Panel toolbar baru di sisi (mengikuti gaya panel yang sudah ada), judul **"Ilustrasi Analisa"**, expand/collapse.
- Berisi 7 tombol tool di atas + row kecil legend/warna preset.
- Saat tool aktif: klik untuk letakkan titik, double-click / Enter untuk selesai (mengikuti pola tangent existing).
- Anotasi tersimpan di `sketch.analysisIllustrations` (array baru) — persist ke `dabidabis_masterplan_canvas_v1`.
- Tampil di kanvas Master Plan sebagai layer paling atas (di atas jalan, di bawah handle edit).
- Ikon **mata (visibility)** & **kunci** ikut standar layer (bisa disembunyikan/dikunci).

## Slide "Analisis Kawasan" (presentasi)

- Slide baru muncul di `buildSlides` **hanya jika**:
  - `sk.linkedMasterplan` present (sketsa presentasi mengimpor dari masterplan), DAN
  - Masterplan sumber memiliki ≥ 1 anotasi ilustrasi analisa.
- Urutan: **setelah** "Analisis Masterplan Kawasan" dan "Siteplan Kawasan".
- Konten: SVG top-view kawasan (reuse `TopView`) + overlay seluruh anotasi ilustrasi analisa dengan style aslinya, plus legend otomatis (warna → label preset), compass, judul proyek.

## Perubahan file

### Baru
- `src/lib/analysis-illustrations.ts` — tipe `AnalysisAnnotation` (union: `arrow`, `zone`, `flow`, `node`, `access`, `label`, `border`), helper render SVG (path builder untuk garis/tangent + arrowhead + dash), preset warna & konstanta.

### Diedit
- `src/routes/sketch.tsx` (dipakai juga untuk `/masterplan` via `SketchPage`):
  - Tambah state `annotations` + toolbar "Ilustrasi Analisa" (hanya di `mode="masterplan"`).
  - Tambah interaksi gambar (klik titik → polyline; Enter = commit; Esc = batal) reuse `sampleTangent`.
  - Render anotasi di kanvas SVG.
  - Persist ke store masterplan.
- `src/lib/masterplan-analysis.ts`:
  - Tambah field `analysisAnnotations: AnalysisAnnotation[]` ke `MasterplanAnalysis`, load dari sketsa.
- `src/routes/presentasi.tsx`:
  - Tambah `AnalisisKawasanBody` (SVG top-view + overlay anotasi + legend + compass).
  - `buildSlides`: append slide "Analisis Kawasan" saat kondisi terpenuhi.

## Catatan teknis

- **Tidak** mengubah perhitungan `totalFootprintM2`, `totalGfaM2`, dll — anotasi murni visual.
- Reuse `sampleTangent` dari `src/lib/axes.ts` untuk semua path kurva (konsisten dengan tangent existing).
- Arrowhead digambar SVG `<marker>` (single def per slide).
- Dash pattern default: `[14, 8]` (px pada skala master).
- Warna preset selaras palet Charcoal & Ember (semantic tokens); warna khusus notasi tetap warna literal karena bagian dari makna diagram (merah = residensial intensif, biru = kanal, hijau = pedestrian, oranye = bus, ungu = future development).
- Simpan `strokeWidthPx` dalam pixel dunia agar konsisten saat zoom.

## Verifikasi

- Buat 1 anotasi dari tiap tool di masterplan, refresh → tersimpan.
- Buka presentasi dari sketsa terkait → slide "Analisis Kawasan" muncul setelah "Siteplan Kawasan".
- Sketsa tanpa link masterplan atau tanpa anotasi → slide tidak muncul.
- Toggle hidden/lock pada layer ilustrasi berfungsi.
- Typecheck via `tsgo` bersih.
