# Architecture decisions

- Architectural detail is a persisted optional per-area mode; normalization enforces exclusion with material, ceiling and interior dimensions, while Presentation reuses merged wall-band geometry with token-based gradients and a wall-only SVG shadow so technical views remain unchanged.

- Free stairs store a polyline and width-offset side, with shared free-stair-geometry generating flights and automatic bend landings for Sketch and Presentation; this keeps arbitrary turns and elevations consistent across views and file transforms.

- Polling notifikasi hanya berjalan saat sesi autentikasi memiliki token dan tidak bergantung pada identitas fungsi render, agar tidak mengirim permintaan tanpa izin atau mengulang tanpa henti.
- Tabel Rincian per Level memakai area gulir vertikal mandiri dan fill handle material hanya menyalin sepanjang kolom serta level yang sama agar pengisian massal tidak bocor ke data lain.
- Pintu dan jendela terpasang diedit melalui sub-mode alat masing-masing agar seleksi, orientasi, dan drag endpoint tidak bentrok dengan alat global.
- Pintu lipat menyimpan mode satu/dua sisi, arah sisi tunggal, dan jumlah panel; panjang fisik daun dipertahankan saat diproyeksikan 45° sehingga sisa bukaan berada di kusen seberang atau di tengah, konsisten di Sketsa, Detail, Presentasi, dan DXF.
- Dimensi interior Slide Detail mengukur bentang bersih permukaan-ke-permukaan tanpa interval ketebalan dinding, sejajar dinding acuan, dan menggeser 150 mm hanya rangkaian interval di bawah 200 mm yang berdampingan; dimensi luar hanya memproyeksikan muka material dan menempatkan rangkaian interval di bawah 400 mm pada jalur berulang 400/550/700 mm dari kotak detail, area tayang meluas 1 m, serta denah menjadi putih polos saat opsi aktif.
- Ujung terbuka dan pertemuan Dinding Solid/standar 150 mm memakai kolom praktis 150 × 150 mm; solid hitam, standar putih dengan finishing 15 mm.
- Furniture Detail disimpan bersama kotak detail dengan ID ruang, kategori, dan posisi relatif terhadap ruang; daftar kategori disimpan per akun, ukuran katalog/tabel dalam mm dikonversi memakai skala sketsa agar ikut bergeser ketika ruang berubah, sementara ceklis per kotak mengendalikan kemunculan di Presentasi.
- Slide rekap Furniture diaktifkan per sketsa melalui `showFurnitureSlide`, mengambil seluruh furniture kotak detail, mengelompokkan kategori, dan mengurutkan level berdasarkan elevasi.
- Slide Denah/Detail menggambar furniture setelah bidang ruang tetapi sebelum notasi teknis, sedangkan label ruang ditaruh terakhir agar informasi ruang selalu terbaca.
- Notasi tangga Slide Denah/Detail memakai bidang potong 1 m dengan garis batas 45°, bagian di atas bidang potong putus-putus, sisi dalam tegas, arah naik/turun mengikuti bordes, dan tangga tipikal tengah ditampilkan utuh.
- Pustaka material beserta nama, gambar, deskripsi, dan produk tersimpan per akun melalui penyimpanan proyek bersama, sedangkan pilihan material tiap ruang tersimpan pada layer sketsa dengan ID material agar perubahan data tetap tersinkron.
- Mode Material pada setiap kotak detail memakai ID material ruang untuk warna dan kode lantai/dinding, dengan legenda pada rel kanan Slide Detail; nilai awalnya nonaktif agar presentasi lama tidak berubah.
- Slide Outline Spesifikasi diaktifkan per sketsa dari kepala Material Rincian per Level, menggabungkan pemakaian pustaka material per jenis, memakai tabel A3 lanskap selebar bidang, serta mengalirkan baris lintas halaman menurut tinggi tersedia sambil mengulang identitas material pada sambungan daftar ruang agar tidak terpotong atau menyisakan halaman kosong.
- Pekerjaan Dasar dan Fasad disimpan sebagai pilihan material umum per sketsa, terpisah dari material ruang; Fasad dibagi Barat, Timur, Utara, dan Selatan.
- Mode Plafon per kotak detail saling eksklusif dengan mode Material dan memakai kode material bersama yang sama dengan Outline Spesifikasi.
- Detail wall symbols, legend wall areas, and Outline Specification wall totals share roomWallSpans to match each room perimeter against actual same-level sketch lines, merge duplicate overlaps, and exclude unlined boundaries consistently.
- Outline Specification per-level location areas and all-level totals share specMaterialArea; location fragments retain the full level area and pagination measures the displayed room-and-area text to prevent clipping.