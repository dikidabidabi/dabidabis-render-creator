# Pemuatan Akun dan Proyek Tanpa Batas Waktu

## Tujuan
Aplikasi menunggu pemeriksaan akun dan pemuatan proyek sampai proses asli selesai, tanpa memaksa masuk sebagai tamu atau membuka proyek dari pemulihan akibat batas waktu.

## Perubahan
- Hapus batas waktu pemeriksaan sesi akun dan biarkan hasil layanan akun menentukan pengguna aktif.
- Hapus batas waktu pemuatan proyek dan tunggu seluruh data proyek selesai dibaca.
- Pertahankan penanganan kegagalan nyata: jika layanan atau penyimpanan benar-benar mengembalikan kesalahan, tampilkan pesan kegagalan yang sudah tersedia dan jangan menganggapnya sebagai timeout.
- Pastikan pergantian akun tetap memuat data milik akun yang benar dan tidak mencampur proyek antar-akun.

## Verifikasi
- Pastikan aplikasi tetap menampilkan status pemuatan selama proses akun/proyek berlangsung.
- Pastikan halaman terbuka setelah kedua proses selesai.
- Periksa hasil kompilasi dan kesalahan pada tampilan aplikasi.
