# Seleksi Marquee Pick Material

## Perubahan
- Pertahankan klik satu garis seperti sekarang.
- Saat pengguna menarik pada area kosong, tampilkan kotak marquee dan pilih semua segmen garis level aktif yang tersentuh kotak.
- Terapkan material aktif ke seluruh hasil seleksi sekaligus; Alt atau Shift menghapus material dari seluruh hasil seleksi.
- Tampilkan sorotan sementara pada segmen yang masuk kotak dan perbarui petunjuk alat.

## Verifikasi
- Uji klik tunggal dan seleksi marquee pada beberapa garis di level aktif.
- Pastikan garis level lain tidak berubah meskipun berada pada posisi yang sama.
- Uji Alt/Shift marquee untuk menghapus tanda material.
- Pastikan aplikasi berhasil dibangun tanpa error.

## Teknis
Seleksi memakai segmen hasil topologi Pick Material yang sudah ada. Segmen dianggap terpilih bila memotong atau berada di dalam batas marquee, sehingga garis panjang tidak harus seluruhnya masuk ke kotak.
