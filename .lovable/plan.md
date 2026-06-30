## Tujuan
Di halaman Masterplan, tambahkan visualisasi "garis lapis" pada model 3D, sistem extrude per 4 m sesuai jumlah lapis, dan kemampuan **sub-bangunan** (massa tambahan di atas bangunan induk) lewat tombol (+) di panel Level.

## Perubahan

### 1. Model data (`src/routes/sketch.tsx`)
- Tambah field opsional `parentLayerId?: string` pada `Layer` untuk menandai sub-bangunan.
- Sub-bangunan tetap layer biasa (punya `points`, `floors`, `levelId` sendiri) tapi terikat ke induknya untuk akumulasi luas.
- Normalizer mempertahankan field baru.

### 2. Panel Level — tombol (+) per sub-layer (mode masterplan)
- Di samping setiap sub-layer bangunan tampilkan tombol kecil `+`.
- Klik (+):
  - Hitung `mdpl` baru = `induk.level.mdpl + induk.floors * 4`.
  - Buat (atau pakai) Level dengan mdpl tersebut, lalu aktifkan level itu pada sketsa.
  - Set `parentLayerId` calon layer berikutnya ke id induk (via state "pending parent" sehingga polygon berikutnya yang digambar otomatis menjadi sub-bangunan dari induk).
- Render sub-bangunan sebagai baris indentasi di bawah induknya dengan label "lapis" yang sama; baris **Total bangunan** induk mengakumulasi `(induk.area × induk.floors) + Σ(sub.area × sub.floors)`. Pada sub TIDAK ditampilkan baris total.

### 3. Label kanvas sketsa (mode masterplan)
- Sub-bangunan: label sama (`bangunan`, `N lapis · total m²`, `luas lantai dasar`) tapi tanpa garis total agregat — agregasi hanya muncul pada induk.

### 4. 3D preview (`src/components/masterplan-sketch-3d-preview.tsx`)
- Tinggi extrude = `floors × 4 m` (sudah ada).
- **Garis lapis**: untuk setiap bangunan, gambar garis horisontal (LineSegments dari ring outer) pada setiap kelipatan 4 m sampai puncaknya, warna tipis gelap. Implementasi: buat `EdgesGeometry` dari ring polygon di setiap ketinggian `base + i*4` untuk `i = 1..floors-1` (tidak menggambar di base & top karena sudah ada `<Edges/>`).
- Sub-bangunan otomatis ter-extrude di atas induk: `base = induk.baseMdpl + induk.floors*4` (via level yang dibuat tombol +). Karena sub adalah layer terpisah dengan level baru, loop meshes existing sudah otomatis menumpuk; tambahkan fallback: jika `parentLayerId` ada dan tidak punya level eksplisit, hitung base dari induk + induk.floors*4.

## Catatan teknis
- Tidak menambah dependency baru.
- Garis lapis dibatasi pada bangunan (skip "Lahan", "Taman", "Void").
- Build cek dengan tsgo/vite biasa.
