# Halaman Detail dan Penataan Furniture

## Hasil yang dibangun
- Tambahkan halaman **Detail** di navigasi Project, tepat di antara **Sketsa** dan **Tabulasi**.
- Halaman menampilkan satu bagian untuk setiap judul sketsa. Di dalamnya terdapat daftar semua kotak pendetailan yang sudah dibuat pada sketsa tersebut, lengkap dengan nomor dan level asal.
- Setiap kotak detail dapat dibuka sebagai bidang kerja yang menampilkan potongan denah sesuai batas kotak dari halaman Sketsa.

## Furniture
- Sediakan panel di sisi bidang kerja dengan katalog dasar berupa gambar denah furniture: meja, kursi, sofa, tempat tidur, lemari, dan sanitary.
- Klik item katalog menempatkannya tepat di tengah kotak detail aktif.
- Tambahkan tombol impor gambar (PNG, JPG, atau WebP) untuk membuat furniture kustom dan langsung menempatkannya di tengah.
- Furniture dapat dipilih dan digeser di dalam kotak detail.
- Saat aktif, tampilkan pegangan rotasi di kanan atas; rotasi mengikuti kelipatan 5 derajat.
- Saat aktif, tampilkan pegangan sudut untuk mengubah skala secara proporsional.
- Sediakan aksi hapus untuk furniture terpilih.

## Penyimpanan dan sinkronisasi
- Simpan posisi, ukuran, rotasi, sumber gambar, dan kaitan furniture ke `sketchId + detailAreaId`, sehingga setiap detail dan setiap proyek tetap terpisah.
- Gunakan penyimpanan proyek per akun yang sudah ada, termasuk pemulihan saat halaman dibuka kembali.
- Sertakan data furniture saat sketsa diekspor, diimpor, diduplikasi, atau digabung.
- Tampilkan furniture yang sama pada Slide Detail di halaman Presentasi, pada koordinat dan rotasi yang sesuai.

## Teknis
- Tambahkan modul data furniture bersama untuk tipe, normalisasi, katalog, dan penyimpanan.
- Buat route `/detail` dengan metadata unik dan tampilan yang mengikuti desain Dabidabi's.
- Render bidang detail dengan sistem koordinat kotak pendetailan agar furniture tetap sejajar saat ukuran layar berubah.
- Gunakan pointer events untuk drag, rotasi, dan skala; batasi ukuran minimum serta tangani sentuhan dan mouse.
- Perbarui navigasi Project dan kartu alat tanpa mengubah urutan alat lain.

## Verifikasi
- Uji daftar sketsa dan detail, buka/tutup tiap detail, tambah furniture katalog, impor gambar, drag, rotasi 5°, skala, hapus, dan muat ulang.
- Pastikan susunan furniture muncul pada Slide Detail Presentasi.
- Periksa tampilan desktop dan layar sempit, lalu pastikan aplikasi tetap berhasil dibangun tanpa error.
