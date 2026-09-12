# Koreksi Potongan Tangga dan Railing

## Tujuan
Memperbaiki gambar tangga pada slide potongan agar pelat tangga dan railing mengikuti geometri tiap bidang secara arsitektural.

## Perubahan
- Bentuk pelat tangga setebal 15 cm di bawah garis dasar anak tangga, dengan sisi bawah rata dan miring sejajar kemiringan lintasan tangga.
- Sambungkan pelat miring tersebut ke pelat bordes setebal 15 cm yang tetap datar, tanpa putus atau tumpang tindih.
- Bentuk garis railing 1,1 m di atas lintasan tangga: miring pada anak tangga, datar pada bordes, dan tersambung di peralihannya.
- Untuk potongan melintang, tampilkan dua railing pada tepi dalam dan tepi luar tangga, bukan satu railing di garis tengah.
- Pertahankan aturan bahwa hanya bagian tangga yang benar-benar terkena garis potong yang muncul.

## Teknis
- Susun hasil perpotongan menjadi segmen lintasan berdasarkan jenis `tread` dan `landing`, lalu hitung garis atas, garis bawah ber-offset normal 15 cm, serta sambungan antarsegmen.
- Bedakan orientasi potongan memanjang dan melintang dari arah garis potong terhadap arah bentang tangga.
- Pada potongan melintang, proyeksikan posisi kedua tepi tangga untuk penempatan railing sisi dalam dan luar.
- Verifikasi hasil TypeScript, build, dan tampilan slide potongan pada ukuran desktop.
