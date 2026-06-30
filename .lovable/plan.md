## Tujuan
1. **Fitur "Jalan" di halaman Sketsa** dengan sub-tool persis seperti di Masterplan.
2. **Tombol "→" di Masterplan** pada sub-layer induk bangunan untuk mengekspor bangunan ke halaman Sketsa, lengkap dengan sinkronisasi dua arah, konversi level, "ruang referensi", area "Lahan", judul proyek, dan slide masterplan otomatis.

---

## A. Fitur "Jalan" di halaman Sketsa (`src/routes/sketch.tsx`)

Saat ini tombol toolbar `jalan`, panel sub-tool, dan logika gambar/edit jalan **sudah ada** tetapi di-gate dengan `mode === "masterplan"` di tiga tempat:
- baris ~10285 (tombol toolbar Jalan)
- baris ~10349 (panel sub-tool Jalan)
- baris ~10274 (tombol toolbar Aksis — tidak diubah)

Buka gate `mode === "masterplan"` menjadi `(mode === "masterplan" || mode === "sketch")` hanya untuk tombol & panel **Jalan** (Aksis tetap eksklusif Masterplan). Logika rendering (`roadCorridorPolygon`, persil split, vertex edit) sudah jalan untuk kedua mode karena membaca `sketch.roads`.

Catatan: di mode sketsa, road tidak akan memicu "persil" split di luar "Lahan" (logika existing sudah memerlukan polygon "Lahan"); ini sesuai harapan.

---

## B. Ekspor Bangunan Masterplan → Sketsa

### B1. Tombol "→" di panel Level (mode masterplan)
Di `LevelsPanel` (panel level mode masterplan), pada baris **sub-layer yang berperan sebagai layer induk bangunan** (sudah ada deteksi untuk tombol `+` sub-bangunan), tambahkan tombol kecil di sebelahnya berikon panah kanan (lucide `ArrowRight`). Tooltip: "Ekspor ke sketsa untuk didetailkan".

Klik → panggil `exportBuildingToSketch(rootLayerId)`.

### B2. Skema data baru
Tambahkan di tipe `Layer` (file sketch.tsx):
- `refSourceSketchId?: string` — id sketsa masterplan asal
- `refSourceLayerId?: string` — id layer induk di masterplan
- `isReferenceRoom?: boolean` — true untuk "ruang referensi" hasil konversi

Tambahkan di tipe `Sketch`:
- `linkedMasterplan?: { sketchId: string; rootLayerId: string }` — sketsa yang berasal dari ekspor masterplan

Normalizer persist (loader/saver yang sudah ada) dipertahankan agar field opsional baru selalu round-trip.

### B3. Algoritma ekspor (`exportBuildingToSketch`)
Input: `rootLayerId` di sketsa masterplan aktif.

1. Kumpulkan **induk + semua sub-layer rekursif** (`parentLayerId === root` / cucu, dst.), urutkan menaik berdasarkan `level.mdpl`.
2. Cari/buat sketsa target:
   - Judul = nama bangunan layer induk (mis. "Bangunan A").
   - Jika sudah ada sketsa dengan `linkedMasterplan.rootLayerId === root.id`, pakai itu (re-sync, bukan duplikasi).
   - Jika belum ada, buat sketsa baru (tambah ke `STORAGE_KEY = dabidabis_sketch_v2`), scale default mengikuti masterplan, set `linkedMasterplan`.
3. Susun **levels** di sketsa target:
   - Level "Lahan" (mdpl 0) — lantai dasar referensi.
   - Untuk setiap layer pada bangunan (induk + sub) urut menaik: 1 level baru, nama `"LT 1"`, `"LT 2"`, dst.
4. Susun **layers**:
   - **Layer "Lahan"** di level Lahan: polygon = area persil (dari `roadNetworkRegions` di masterplan yang memuat induk; fallback: `sitePolygon`). Kunci `locked: true`, nama `"Lahan"`. Ini **dianggap layer biasa** sehingga ikut perhitungan tabulasi/presentasi.
   - **"Ruang referensi N"** di tiap level LT: polygon = footprint layer masterplan tsb (dikonversi koordinat dunia px). `isReferenceRoom: true`, `refSourceSketchId/refSourceLayerId` diisi.
5. Simpan sketsa target (memicu update tabulasi/narasi/presentasi otomatis — semua halaman tsb membaca dari `dabidabis_sketch_v2`).
6. Navigate (`useNavigate`) ke `/sketsa` dan set `openId` ke sketsa target.

### B4. Sinkronisasi dua arah
Buat util `src/lib/masterplan-sketch-sync.ts` dengan dua fungsi:
- `syncSketchReferenceToMasterplan(sketchId)` — saat user mengedit polygon "Ruang referensi N" di sketsa, replikasi geometry ke `layers[refSourceLayerId].points` di sketsa masterplan, lalu `save`.
- `syncMasterplanLayerToSketch(rootLayerId)` — saat user mengedit footprint bangunan di masterplan, replikasi ke semua sketsa yang punya `linkedMasterplan.rootLayerId === rootLayerId` (update polygon "Ruang referensi" yang `refSourceLayerId` cocok).

Hook keduanya:
- Di `onChange` sketsa (debounced), jika layer yang berubah adalah ruang referensi, panggil `syncSketchReferenceToMasterplan`.
- Di `onChange` masterplan, jika layer yang berubah punya descendant di sketsa target, panggil `syncMasterplanLayerToSketch`.

Guard rekursi: tandai update sebagai `__fromSync = true` agar tidak memicu loop.

### B5. Aturan tampilan "Ruang Referensi"
- **Tabulasi** (`src/routes/tabulasi.tsx`): di `computeStats` & komponen rincian, skip layer dengan `isReferenceRoom === true` saat menghitung luas/komposisi.
- **Presentasi** (`src/routes/presentasi.tsx`): di renderer denah, gambar polygon referensi sebagai **garis putus-putus tipis abu** tanpa label/luas (atau langsung skip kalau lebih bersih). "Lahan" tetap dirender.
- **Sketsa**: render polygon referensi dengan stroke putus-putus + fill transparan + label kecil "ref" sehingga jelas berbeda dari ruang asli. Bisa diedit (drag vertex) untuk memicu sync.

### B6. Judul proyek
Tambah field `linkedSketchId?: string` di `MasterPlan` (`src/lib/masterplan.ts`). Saat ekspor, set `linkedSketchId = sketsa.id`. Di komponen yang menampilkan "Judul Proyek" untuk presentasi:
- Jika `sketch.linkedMasterplan` ada → judul proyek = title sketsa **masterplan** (`localStorage["dabidabis-masterplan-v1"]` punya nama, atau pakai default "Master Plan" — kita tambahkan field `title?: string` di `MasterPlan` jika belum ada).
- Else → judul proyek = title sketsa biasa (perilaku existing).

### B7. Slide Masterplan di Presentasi
Di `src/routes/presentasi.tsx`, deteksi `sketch.linkedMasterplan`. Jika ada, sisipkan **2 slide baru sebelum slide denah bangunan pertama**:
1. **"Denah Masterplan"** — render 2D dari sketsa masterplan (re-use renderer existing yang menggambar layers + roads + persil).
2. **"Aksonometri Masterplan"** — re-use `<MasterplanSketch3DPreview>` (sudah ada komponen 3D).

Slide-slide ini auto-muncul, tidak ada toggle khusus.

---

## C. Detail teknis kecil

- Konversi koordinat px↔meter di masterplan vs sketsa: keduanya sudah menggunakan `pxPerMeter` dari `scale`. Saat ekspor, polygon disimpan dalam unit pixel sketsa target (dengan `scale` sketsa target = scale masterplan agar 1:1 secara meter).
- Mode `sketch` sudah default — tidak ada perubahan routing.
- Tidak menambah dependency baru.

## Sanity check
- Build via Vite (otomatis).
- Manual: buat 1 bangunan masterplan dengan sub, klik →, lalu cek (a) sketsa baru muncul, (b) "Lahan" ada & berkontribusi ke tabulasi, (c) "Ruang referensi 1/2" muncul putus-putus & tidak terhitung, (d) tabulasi & narasi & presentasi memunculkan judul baru, (e) slide masterplan muncul sebelum denah, (f) edit ruang referensi mengubah masterplan, dan sebaliknya.
