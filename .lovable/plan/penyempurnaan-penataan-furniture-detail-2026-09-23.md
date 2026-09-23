# Penyempurnaan Penataan Furniture Detail

## Hasil yang dibangun
- Tambahkan tombol layar penuh pada bidang kerja Detail, dengan tombol keluar dan dukungan perubahan ukuran layar.
- Tambahkan zoom dan geser bidang kerja: cubit dua jari pada layar sentuh, roda/trackpad, serta kontrol perbesar, perkecil, dan kembali ke ukuran awal.
- Pastikan drag furniture tetap akurat pada semua tingkat zoom.

## Seleksi dan duplikasi
- Ubah seleksi menjadi multi-seleksi melalui klik/tap dengan penambah seleksi, serta kotak seleksi pada area kosong.
- Furniture terpilih dapat digeser bersama, dihapus bersama, disalin, dan ditempel tanpa mengubah ukuran maupun rotasinya.
- Clipboard furniture disimpan per akun agar hasil salinan dapat ditempel ke kotak detail lain, termasuk detail pada proyek lain.
- Saat ditempel, pusat susunan diposisikan ke tengah kotak aktif dan jarak relatif antar-furniture dipertahankan.

## Pustaka furniture impor
- Setiap PNG, JPG, atau WebP yang diimpor otomatis ditambahkan ke pustaka furniture milik akun.
- Pustaka impor tampil bersama katalog dasar pada panel furniture dan dapat digunakan di seluruh proyek akun tersebut.
- Hindari entri ganda untuk gambar yang sama, dan sediakan tindakan hapus dari pustaka tanpa menghapus furniture yang sudah ditempatkan.

## Kontrol Slide Detail
- Tambahkan ceklis **Furniture** pada setiap kotak di alat Pendetailan halaman Sketsa.
- Furniture hanya dirender pada Slide Detail Presentasi jika ceklis tersebut aktif.
- Detail lama tetap menampilkan furniture secara bawaan agar hasil yang sudah ada tidak tiba-tiba hilang.

## Teknis
- Simpan status `showFurniture` bersama setiap kotak detail.
- Simpan clipboard dan pustaka impor pada penyimpanan akun yang sudah ada agar tersedia lintas proyek tanpa bocor antar-akun.
- Gunakan transform koordinat bidang kerja untuk zoom/pan dan pointer events untuk mouse maupun sentuhan.
- Pertahankan ekspor/impor proyek untuk furniture yang terpasang; pustaka akun tetap terpisah dari isi proyek.

## Verifikasi
- Uji layar penuh, pinch zoom, wheel zoom, pan, dan drag pada beberapa tingkat zoom di desktop serta layar sentuh sempit.
- Uji seleksi banyak, drag bersama, hapus, salin-tempel pada detail yang sama, detail lain, dan setelah berpindah proyek.
- Uji impor masuk pustaka, penggunaan ulang, deduplikasi, serta pemulihan setelah muat ulang.
- Uji ceklis Furniture aktif/nonaktif pada Slide Detail Presentasi dan pastikan aplikasi berhasil dibangun tanpa error.
