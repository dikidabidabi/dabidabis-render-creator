# Aturan Warna Slide Denah dan Detail

## Hasil yang dibangun
- Slide **Denah** selalu memakai warna ruang semula dan tidak menampilkan diagram persentase zona fungsi.
- Slide **Detail Denah** tanpa hatch lantai memakai warna zona fungsi untuk ruang yang sudah dikelompokkan, dengan warna ruang sebagai cadangan.
- Slide **Detail Denah** dengan **Hatch lantai 600 × 600 mm** memakai latar ruang putih dan garis hatch tipis, tanpa warna zona maupun warna ruang.
- Diagram persentase zona fungsi di kiri bawah hanya tampil pada slide Detail Denah ketika hatch lantai tidak aktif dan terdapat data zona pada lantai tersebut.

## Teknis
- Batasi perubahan pada renderer presentasi tanpa mengubah data zona, pengaturan detail, atau halaman Tabulasi.
- Pertahankan notasi dinding, pintu, jendela, grid, dimensi, key plan, dan label ruang yang sudah ada.
- Verifikasi slide Denah serta kedua kondisi slide Detail Denah.
