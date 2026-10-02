# Percepat Pengisian Rincian per Level

## Perubahan
- Batasi tinggi setiap tabel Rincian per Level dan sediakan gulir vertikal di sisi kanan; judul kolom tetap terlihat saat tabel digulir.
- Tambahkan fill handle di pojok kanan bawah pilihan material yang sudah terisi.
- Saat fill handle ditarik ke atas atau bawah, salin material sumber ke seluruh baris yang dilewati pada kolom dan level yang sama.
- Beri penanda pada rentang yang akan diisi selama drag berlangsung.
- Pudarkan pilihan Zona Fungsi dan Material yang belum diisi agar mudah dibedakan dari data terpilih.

## Verifikasi
- Uji gulir vertikal pada tabel dengan banyak ruang.
- Uji drag material lantai, dinding, dan plafon ke beberapa baris tanpa memengaruhi kolom atau level lain.
- Pastikan perubahan tersimpan dan aplikasi berhasil dibangun tanpa error.

## Teknis
Fill handle memakai pointer drag pada sel material dan menyimpan hasil satu kali saat drag selesai agar perubahan banyak baris tetap efisien.
