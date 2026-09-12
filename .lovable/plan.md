# Fitur Tangga pada Halaman Sketsa

## Hasil yang dibangun
- Tambahkan alat **Tangga** di panel **ALAT** dengan tiga jenis: **Lurus**, **U**, dan **Lingkar**.
- Tangga dibuat dengan drag stylus/mouse pada kanvas, tersimpan pada level aktif, dan otomatis terhubung ke level tepat di atas berdasarkan urutan MDPL.
- Tangga terlihat pada level asal dan level tujuan, serta ikut tampil pada slide denah kedua level dan slide potongan jika garis potong melintasinya.

## Kontrol alat
- Semua jenis: jumlah anak tangga, informasi otomatis tinggi anak tangga dan lebar pijakan, mode **Gambar**, **Geser**, **Edit**, dan **Hapus**.
- Lurus dan U: lebar tangga serta pilihan aktif/nonaktif bordes.
- U: offset/jarak kosong antar sisi dalam.
- Lingkar: radius dalam.
- Selisih tinggi diambil otomatis dari MDPL level aktif ke level berikutnya. Pembuatan dinonaktifkan dengan pesan yang jelas bila belum ada level di atas.

## Perilaku gambar dan edit
- **Lurus:** area drag menentukan arah dan panjang; lebar mengikuti isian.
- **U:** area drag menentukan panjang dan orientasi dua jalur; lebar, offset dalam, dan bordes mengikuti pengaturan.
- **Lingkar:** drag menentukan pusat, arah awal, dan radius luar; radius dalam mengikuti isian.
- Edit menyediakan titik/handle yang relevan untuk mengubah panjang, arah, dan ukuran; Geser memindahkan seluruh tangga tanpa mengubah bentuk.
- Jumlah anak tangga dibagi ke jalur secara proporsional. Nilai tinggi anak tangga dihitung dari selisih MDPL, sedangkan lebar pijakan dihitung dari panjang lintasan efektif setelah bordes diperhitungkan.

## Integrasi data dan tampilan
- Buat model data serta utilitas geometri tangga terpisah, termasuk normalisasi data lama, footprint, garis anak tangga, lintasan, bordes, hit-test, dan irisan garis potong.
- Simpan tangga bersama data sketsa dan sertakan dalam ekspor, impor, merge, duplikasi level, pemindahan pilihan, serta penghapusan level.
- Render tangga di kanvas sketsa dengan simbol arah naik, anak tangga, bordes, dan gaya berbeda untuk level asal/tujuan.
- Render simbol tangga yang sama di slide denah untuk kedua level.
- Pada slide potongan, gambar profil anak tangga dan bordes hanya ketika garis potong benar-benar beririsan dengan footprint tangga.

## Verifikasi
- Uji ketiga jenis tangga pada dua level dengan MDPL berbeda, termasuk bordes aktif/nonaktif dan perubahan jumlah anak tangga.
- Uji edit, geser, hapus, pergantian level, simpan/muat ulang, ekspor/impor, dan merge.
- Uji denah pada level asal/tujuan serta potongan yang melintas dan tidak melintas tangga.
- Periksa tampilan desktop dan layar sempit, lalu pastikan pemeriksaan tipe dan build bersih.
