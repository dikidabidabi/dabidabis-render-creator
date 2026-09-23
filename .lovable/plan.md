# Potongan Fungsi per Garis Potong

## Hasil yang dibangun
- Tambahkan ceklis **Fungsi** pada setiap item di **Daftar Potongan** pada alat **Garis Potong**.
- Simpan pilihan tersebut bersama data garis potong, termasuk saat proyek diekspor, diimpor, atau dibuka kembali.
- Setiap garis potong yang ceklisnya aktif menghasilkan satu slide **Potongan Fungsi** tambahan; semua slide ini ditempatkan berurutan tepat setelah **Stacking Diagram**, tanpa mengganti slide potongan biasa.

## Isi slide Potongan Fungsi
- Gunakan bidang potong, arah pandang, urutan lantai, tinggi level, dan geometri ruang yang sama dengan potongan biasa.
- Gambar pelat setiap lantai setebal **50 cm** ke bawah dengan warna hitam.
- Tampilkan hanya dinding paling luar di sisi kiri dan kanan massa tiap lantai; hilangkan seluruh kolom struktur dan elemen kolom praktis.
- Warnai ruang berdasarkan **Zona Fungsi**. Ruang tanpa penetapan zona tetap memakai warna ruang sebagai fallback agar proyek lama tetap terbaca.
- Gabungkan bidang ruang yang berdampingan pada lantai yang sama bila zona fungsinya sama, lalu tampilkan satu nama zona pada bidang gabungan.
- Sesuaikan ukuran dan pemenggalan teks otomatis terhadap lebar serta tinggi bidang agar nama zona memenuhi ruang tanpa keluar dari batasnya.

## Tata letak slide
- **Kiri:** aksonometri bertumpuk seperti Stacking Diagram, tetapi massa ruang memakai warna Zona Fungsi.
- **Tengah:** potongan fungsi utama yang memenuhi area terbesar slide.
- **Kanan:** satu diagram cincin untuk setiap lantai yang terpotong, berisi persentase luas per zona dan daftar luas tiap zona dalam m².
- Diagram dan legenda hanya menghitung ruang yang benar-benar terkena garis potong pada lantai tersebut; zona yang sama dijumlahkan per lantai.

## Teknis
- Perluas tipe dan normalisasi `SectionCut` dengan status fungsi yang aman untuk data lama.
- Tambahkan jenis slide khusus pada registry, daftar isi, judul, thumbnail, dan renderer presentasi.
- Pisahkan perhitungan irisan ruang menjadi data yang dapat dipakai ulang oleh potongan biasa dan potongan fungsi.
- Gunakan warna zona yang sudah tersimpan dan utilitas warna yang sama dengan Tabulasi/slide Detail.
- Verifikasi penyimpanan ceklis, urutan slide untuk satu maupun beberapa potongan, penggabungan zona berderet, ketebalan pelat 50 cm, tanpa kolom, serta tampilan desktop dan layar kecil.
