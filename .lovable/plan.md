# Koreksi jalur dimensi luar ruang

## Perubahan
- Ubah aturan khusus dimensi di luar ruang pada Slide Detail dengan opsi Dimensi Interior aktif.
- Anggap interval di bawah 400 mm sebagai dimensi pendek yang berpotensi menumpuk bila berurutan.
- Untuk setiap rangkaian dimensi pendek berurutan, tempatkan jalur ukur berulang pada offset 400 mm, 550 mm, dan 700 mm dari batas kotak detail, lalu kembali ke 400 mm.
- Dimensi tunggal yang tidak menjadi rangkaian tetap memakai jalur dasar 400 mm.
- Pertahankan aturan dimensi di dalam ruang tanpa perubahan.

## Verifikasi
- Uji rangkaian dua, tiga, dan lebih dari tiga interval di bawah 400 mm pada keempat sisi.
- Pastikan interval 400 mm atau lebih memutus rangkaian dan memakai jalur dasar.
- Pastikan aplikasi berhasil dibangun tanpa kesalahan.
