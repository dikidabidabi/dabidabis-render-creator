# Zona Fungsi pada Tabulasi dan Slide Denah

## Hasil yang dibangun
- Tambahkan kolom **Zona Fungsi** pada tabel **Rincian per Level** untuk setiap ruang.
- Tambahkan pengelola daftar zona fungsi di bawah tabel: pengguna dapat menambah, mengganti nama, dan menghapus lebih dari satu zona.
- Setiap zona mendapat warna berbeda secara otomatis; pilihan zona pada baris ruang langsung tersimpan pada proyek aktif.
- Sertakan zona fungsi pada hasil Excel proyek.

## Slide presentasi
- Pada slide denah setiap lantai, ruang yang sudah dikelompokkan memakai warna zona fungsi.
- Jika proyek belum memiliki daftar zona fungsi, warna ruang lama tetap digunakan tanpa perubahan.
- Tambahkan diagram cincin di kiri bawah slide denah yang menghitung persentase luas tiap zona pada lantai tersebut, lengkap dengan nama, warna, dan persentase.
- Ruang yang belum dipilih zonanya tetap memakai warna ruang dan tidak dimasukkan ke persentase zona.

## Teknis
- Simpan definisi zona pada data sketsa proyek dan simpan pilihan zona pada ID ruang, sehingga ikut dalam ekspor, impor, sinkronisasi lokal, dan pemulihan proyek.
- Gunakan palet warna deterministik agar warna tiap zona konsisten di Tabulasi dan Presentasi.
- Perbarui data melalui penyimpanan proyek yang sudah ada agar halaman lain menerima perubahan otomatis.
- Verifikasi tampilan Tabulasi, slide denah Presentasi, penyimpanan setelah muat ulang, dan kondisi tanpa zona fungsi.
