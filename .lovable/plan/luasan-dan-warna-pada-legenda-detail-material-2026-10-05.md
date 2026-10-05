# Luasan dan Warna pada Legenda Detail Material

## Hasil yang dibangun
- Tambahkan lingkaran warna pada setiap baris legenda Material dan Plafon, memakai warna material yang sama dengan bidang denah.
- Tampilkan total luas cakupan per material dalam satuan m².
- Lantai dan plafon dijumlahkan dari luas ruang yang memakai material tersebut.
- Dinding dihitung dari total keliling ruang yang memakai material tersebut dikali tinggi tetap 3 m.

## Aturan perhitungan
- Perhitungan hanya memakai ruang yang termasuk dalam kotak Detail terkait.
- Material yang dipakai oleh beberapa ruang digabung menjadi satu total pada baris legenda yang sama.
- Untuk dinding bersama, setiap sisi ruang dihitung sebagai permukaan ruang masing-masing karena pilihan material dinding tersimpan per ruang.
- Nilai ditampilkan dengan dua angka desimal agar konsisten dengan luasan ruang.

## Verifikasi
- Periksa warna lingkaran sama dengan warna bidang material di denah.
- Uji satu material pada beberapa ruang dan beberapa material berbeda.
- Uji luas lantai/plafon serta luas dinding dengan rumus keliling × 3 m.
- Pastikan legenda Material dan Plafon tetap muat dan aplikasi berjalan tanpa kesalahan.
