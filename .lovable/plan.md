# Slide Furniture dan Gambar Detail Konstruktif

## Hasil yang dibangun
- Tambahkan ceklis **Kirim ke presentasi** di kanan atas judul Tabel furniture.
- Simpan status ceklis pada sketsa aktif sehingga tetap sama saat berpindah kotak detail atau membuka ulang proyek.
- Saat aktif, tambahkan slide **Furniture** tepat sebelum slide **Estimasi Biaya**.
- Slide merangkum seluruh furniture dari semua kotak detail pada sketsa, dikelompokkan menurut kategori dan diurutkan berdasarkan urutan level.
- Setiap baris menampilkan level, nama furniture, ukuran, jumlah, harga per item, dan harga total; item identik digabung hanya pada rekap tabel.

## Gambar kotak detail
- Lengkapi bidang kerja Detail dengan ketebalan dinding sesuai material yang dipilih.
- Tampilkan kolom struktur yang aktif pada level tersebut.
- Tampilkan simbol pintu dan jendela beserta orientasinya.
- Pertahankan furniture dan tag nama sebagai elemen yang dapat dipilih/ditata di atas denah konstruktif.

## Teknis
- Tambahkan flag presentasi pada data sketsa dan pertahankan kompatibilitas proyek lama dengan nilai bawaan nonaktif.
- Gunakan urutan elevasi level untuk rekap furniture dan kategori **Tanpa kategori** sebagai fallback.
- Gunakan geometri bersama untuk ketebalan material, grid struktur, pintu, dan jendela agar gambar Detail konsisten dengan Sketch/Presentasi.
- Catat keputusan struktur data dan perbarui roadmap.

## Verifikasi
- Uji ceklis tersimpan setelah muat ulang dan berlaku dari semua kotak detail dalam sketsa yang sama.
- Pastikan slide Furniture muncul tepat sebelum Estimasi Biaya hanya saat ceklis aktif.
- Periksa pengelompokan kategori, urutan level, jumlah, ukuran, dan total harga.
- Periksa dinding tebal, kolom, pintu, serta jendela pada beberapa kotak detail dan ukuran layar.
