# Dimensi Pendetailan pada Slide Detail

## Tujuan
Mengatur ulang dimensi pada Slide Detail agar seluruh ukuran ditempatkan di sisi kiri, kanan, atas, dan bawah denah, sejajar dengan perimeter lantai terluar.

## Perubahan
- Gunakan perimeter lantai pada level aktif sebagai acuan sisi terluar denah; bila lantai tidak tersedia, gunakan batas gabungan ruang pada level tersebut sebagai cadangan.
- Saat opsi **Dimensi** pada kotak pendetailan aktif, buat rantai dimensi ruang dari proyeksi setiap as dinding pada sudut atau pertemuan garis ruang.
- Tampilkan rantai dimensi ruang pada keempat sisi denah—kiri, kanan, atas, dan bawah—tepat 1 meter dari perimeter lantai terluar.
- Tampilkan dimensi bentang grid struktur pada keempat sisi denah—kiri, kanan, atas, dan bawah—tepat 2 meter dari perimeter lantai terluar.
- Ganti penempatan dimensi grid saat ini sehingga dimensi ruang dan grid mengikuti aturan empat sisi yang sama.
- Pertahankan garis grid struktur tipis dan putus-putus pada Slide Detail.
- Perluas area pandang Slide Detail secukupnya agar garis bantu, angka dimensi, dan offset 1–2 meter tidak terpotong.

## Aturan Teknis
- Nilai dimensi ditampilkan dalam milimeter, mengikuti format dimensi yang sudah digunakan.
- Titik ukur ruang dideduplikasi dengan toleransi kecil agar sudut atau pertemuan yang sama tidak menghasilkan ukuran ganda.
- Hanya geometri pada level Slide Detail yang dihitung; elemen level lain tidak memengaruhi dimensi.
- Grid berotasi tetap dihitung dan digambar dalam sistem koordinat gridnya, tetapi penempatan rantai ukuran tetap beracuan pada sisi kiri/kanan perimeter lantai.

## Verifikasi
- Uji Slide Detail dengan lantai dan grid biasa: dimensi ruang berada 1 m dan dimensi grid 2 m di kiri, kanan, atas, serta bawah.
- Uji denah dengan beberapa pertemuan dinding untuk memastikan setiap interval as terbaca tanpa duplikasi.
- Uji grid berotasi dan proyek tanpa objek lantai untuk memastikan tampilan tetap utuh.
- Pastikan opsi Dimensi mati menyembunyikan kedua jenis dimensi, sedangkan garis grid tetap tampil.
