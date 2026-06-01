## Tujuan
Pengguna dapat meng-klik segmen garis sketsa (antar titik potong) dan menandainya sebagai **Dinding Solid**, **Curtain Wall**, atau **Window Wall**. Metadata ini hanya memengaruhi notasi 2D di slide Denah & Potongan — tidak mengubah blok 3D di Stacking.

## Arsitektur

### 1. Topologi segmen (virtual, tidak destruktif)
- Helper baru `src/lib/edge-segments.ts`:
  - `computeStraightSegments(lines)` → memecah tiap garis lurus pada **semua titik potong** dengan garis lurus lain (algoritma O(n²) cukup; sketsa tidak besar).
  - `segmentIdFor(a, b)` → id stabil berbasis koordinat dibulatkan 3 desimal, urutan endpoint dinormalisasi (`"x1,y1|x2,y2"`).
  - `pickSegmentAt(point, segments, tol)` → segmen terdekat dengan toleransi piksel.
- Garis asli **tidak dimutasi** (aman untuk grid, undo, edit). Segmen hanya hidup di runtime/render.
- Arc & bezier untuk iterasi ini diperlakukan sebagai satu segmen utuh (tanpa split). Bisa ditingkatkan kemudian.

### 2. State & persistensi
- Tambah ke `Sketch`:
  ```ts
  type EdgeMaterial = "solid" | "curtain" | "window";
  edgeAttrs?: Record<string, EdgeMaterial>; // key = segmentId
  ```
- Serialisasi sudah generik (sketsa di-stringify utuh), jadi cukup tambah field + default `{}` saat load.

### 3. Tool baru di sidebar (`sketch.tsx`)
- Tambah `"pick"` ke union `tool`.
- Tombol di toolbar dengan ikon pipet/kuas; saat aktif menampilkan panel pemilih material di sidebar:
  - **Dinding Solid** — chip hitam `#111`
  - **Curtain Wall** — chip cyan `#22d3ee`
  - **Window Wall** — chip biru tua `#1e3a8a`
- Saat tool = pick:
  - Render semua segmen yang sudah punya attribute dengan stroke warnanya (overlay tipis di atas garis normal) supaya keadaan terlihat.
  - Klik kanvas → `pickSegmentAt` → set `edgeAttrs[id] = material` lewat `onChange`. Klik kanan / Alt+klik → hapus attribute.

### 4. Render denah (LevelBody di `presentasi.tsx`)
Untuk tiap segmen di level yang aktif:
- **solid**: dua garis paralel offset normal `150mm * scaleFactor` (skala denah saat ini), stroke hitam tebal.
- **curtain**: dua garis paralel offset ~`60mm` tipis (cyan gelap untuk preview, hitam saat cetak — kita pakai hitam tipis 0.6px).
- **window (window-wall di denah)**: garis utama + dua garis pendek sisip di tengah segmen (notasi jendela standar).
- Default (belum ditandai): seperti sekarang (garis tunggal).

### 5. Render potongan (SectionBody di `presentasi.tsx`)
Untuk tiap perpotongan cut-line ↔ segmen edge per level:
- Kolom vertikal dari `floor` ke `ceiling` level tersebut, lebar 150mm skala potongan.
- **solid**: fill abu gelap + hatch diagonal 45° (pattern SVG).
- **curtain**: dua garis vertikal tipis menerus full-height + fill biru transparan `rgba(34,211,238,0.25)`.
- **window**: stack vertikal — solid block 0–0.9m, fill kaca biru transparan 0.9–2.4m, solid block 2.4m–plafon (di-clip ke tinggi level).
- Segmen tanpa attribute: render seperti sekarang.

### 6. Pengecualian 3D
- `StackingBody` & `model3d` **tidak membaca** `edgeAttrs`. Tetap massa solid.

## Daftar file yang akan disentuh
- **Baru**: `src/lib/edge-segments.ts`
- **`src/routes/sketch.tsx`**: tipe `EdgeMaterial`, field `edgeAttrs`, tool `"pick"`, tombol toolbar, panel pemilih material, handler klik kanvas, overlay segmen ber-attribute.
- **`src/routes/presentasi.tsx`**: util `computeStraightSegments` dipakai di `LevelBody` & `SectionBody`; tambahkan SVG `<defs>` untuk hatch pattern; logika render per material.

## Catatan teknis
- Stroke colors di kanvas (cyan/biru tua/hitam) hanya untuk **mode edit di sketsa**. Di slide cetak (denah/potongan), kita pakai konvensi gambar arsitektur (hitam + hatch + isi biru transparan) — bukan warna pilih.
- Klik segmen menggunakan jarak titik ke segmen dengan toleransi 6px (di koordinat layar) supaya mudah ditarget.
- Undo/redo mengikuti pola `pushHistory` yang sudah ada; `edgeAttrs` masuk ke snapshot.

## Yang tidak termasuk (di luar scope iterasi ini)
- Split topologi untuk arc/bezier.
- Edit interaktif tinggi sill/header window-wall (pakai default 0.9 m & 2.4 m sesuai spec).
- Variasi gaya per material di view 3D — sesuai instruksi tetap solid massa.
