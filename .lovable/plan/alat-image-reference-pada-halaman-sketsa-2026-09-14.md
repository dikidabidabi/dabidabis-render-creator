# Alat Image Reference pada Halaman Sketsa

## Ringkasan
Menambahkan alat **Image Reference** untuk memasukkan gambar JPG sebagai layer referensi tersendiri pada level aktif. Gambar tampil di atas peta dan di bawah objek gambar sketsa, tersimpan bersama proyek, serta dapat diposisikan dan dikalibrasi terhadap grid milimeter block.

## Perubahan yang Dibangun
- Tambahkan tombol **Image Reference** pada panel ALAT dan panel pengaturannya.
- Unggah JPG/JPEG dengan validasi tipe dan ukuran, lalu tempatkan gambar pada pusat area kerja level aktif.
- Simpan setiap referensi sebagai layer tersendiri dengan level, posisi, ukuran dasar, skala, dan transparansi.
- Tampilkan gambar di atas peta tetapi di bawah grid dan seluruh geometri sketsa.
- Tambahkan mode:
  - **Geser**: drag gambar dengan stylus/mouse tanpa mengubah ukuran.
  - **Skala Bebas**: drag handle sudut dengan rasio gambar tetap.
  - **Skala Acuan**: pilih tiga titik berurutan—awal jarak pada JPG, ujung jarak acuan pada JPG, lalu titik target pada grid. Nilai acuan default 10 m dan dapat diubah; skala gambar dihitung agar jarak JPG sama dengan jarak target grid.
  - **Transparansi**: slider per gambar.
  - **Hapus**: hapus gambar referensi yang dipilih.
- Beri outline, handle, penanda titik kalibrasi, dan status langkah saat alat aktif.
- Pastikan referensi mengikuti perubahan skala kanvas, terhapus bersama level, dan ikut ekspor/impor serta merge proyek.

## Detail Teknis
- Tambahkan tipe data referensi gambar yang menyimpan data URL JPG, dimensi asli, transformasi world-space, level, dan opacity.
- Gunakan cache `HTMLImageElement` agar redraw kanvas tetap lancar dan gambar dimuat ulang saat data proyek dihidrasi.
- Hitung kalibrasi tiga titik dengan faktor `jarak titik 2–3 / jarak titik 1–2`; titik pertama menjadi jangkar agar tidak bergeser saat skala diterapkan.
- Tambahkan `imageReferences` ke normalisasi data, daftar entitas merge, rescaling global, dan pembersihan level.

## Verifikasi
- Uji unggah JPG, urutan layer, geser, skala bebas, kalibrasi tiga titik, transparansi, dan hapus.
- Uji pergantian level, simpan/muat ulang, perubahan skala kanvas, serta ekspor/impor dan merge.
- Periksa tampilan desktop dan layar sempit, lalu pastikan build tanpa error.
