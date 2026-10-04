# Plafon, Kode Material, Pekerjaan Dasar, dan Fasad

## Hasil yang dibangun
- Tambahkan ceklis **Plafon** pada setiap kotak Pendetailan, mati secara bawaan dan saling menonaktifkan dengan ceklis **Material**.
- Saat Plafon aktif, Slide Detail menjadi denah plafon dengan simbol elips horizontal di tengah ruang dan legenda Plafon pada rel kanan.
- Perluas List Material dengan **Pekerjaan Dasar** dan **Fasad**, serta isian **Kode Material** pada seluruh material.
- Bentuk kode simbol dari kode material yang diisi pemilik akun, lalu tambahkan nomor urut untuk material dengan kode dasar yang sama, misalnya `MR1`, `MR2`.
- Tambahkan tabel umum terpisah pada Rincian per Level untuk daftar Pekerjaan Dasar dan empat daftar Fasad: Barat, Timur, Utara, Selatan. Setiap daftar dapat menambah dan menghapus material dari pustaka terkait.
- Perluas Outline Spesifikasi dengan urutan: Pekerjaan Dasar, Lantai, Dinding, Plafon, Fasad. Lokasi fasad menampilkan arah sisi bangunan.

## Kompatibilitas data
- Proyek dan pustaka lama tetap terbaca; kode yang belum diisi memakai kode bawaan per jenis.
- Ceklis Plafon proyek lama tetap nonaktif.
- Pilihan ruang yang sudah ada tidak berubah; data umum Pekerjaan Dasar dan Fasad disimpan terpisah pada sketsa.

## Verifikasi
- Uji eksklusivitas ceklis Material dan Plafon serta nilai awal kotak Detail baru.
- Uji kode kustom berulang, simbol elips, warna bidang plafon, dan legenda Slide Detail.
- Uji tambah/hapus Pekerjaan Dasar dan Fasad per arah serta persistensinya.
- Uji urutan, kode, lokasi, dan pembagian halaman Outline Spesifikasi.
- Periksa tampilan List Material dan Tabulasi pada desktop serta layar kecil, lalu pastikan aplikasi berhasil dibangun.

## Teknis
- Data umum sketsa memakai daftar ID material untuk pekerjaan dasar dan peta arah fasad, terpisah dari `roomMaterials`.
- Satu pembentuk kode bersama dipakai Slide Detail dan Outline Spesifikasi agar hasil penomoran konsisten.
