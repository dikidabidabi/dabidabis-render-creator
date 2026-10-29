# Roadmap

- [x] Predecessor majemuk dipisahkan “;”, tipe/offset per hubungan, tanggal memenuhi semua acuan, kabel setiap hubungan; 60 uji lolos, ketiga contoh dan kabel berwarna serta formulir/penyimpanan ulang/penghapusan teruji pada akun aktif.

- [x] Kalender tabel dan fill handle empat kolom tanggal; aktual mulai/selesai dan bar aktual biru/merah; offset predecessor positif/negatif. 46 uji lolos; kalender, drag tiga baris, bar biru/merah, FS+3 dan muat ulang teruji pada akun aktif; data uji dibersihkan.

- [x] Bar merah keterlambatan tipis membulat dari tenggat hingga tanggal progres 100% atau garis hari bila belum 100%; hanya pekerjaan daun, 32 uji lolos, terverifikasi visual di Gantt dengan akun aktif.
- [x] Pindahkan pengisian progres bertanggal ke tiap pekerjaan; realisasi Kurva S berbobot durasi mulai–tenggat, 31 uji lolos, dua pekerjaan menghasilkan 60% sesuai bobot, riwayat tersimpan setelah muat ulang dan dapat dihapus; teruji pada akun aktif tanpa kesalahan halaman.

- [x] Tambahkan pengisian progres manual bertanggal sebagai acuan Kurva S; entri tersimpan, tampil pada garis Realisasi, bertahan setelah muat ulang, dan dapat dihapus — 24 uji lolos, teruji di browser dengan akun aktif.
- [x] Lipat hierarki WBS dan bentuk bar tahap ringkasan sesuai gambar; lipat/buka dan muat ulang teruji.
- [x] Tambahkan CPM merah dengan ambang slack default 0 hari; sorotan bar/kabel dan perubahan slack 0/5 teruji.
- [x] Tambahkan Kurva S rencana/realisasi berbobot durasi dan tabel angka periodik; 26 uji lolos, realisasi 40% dan penyimpanan teruji pada akun aktif tanpa kesalahan.

- [x] Tampilkan kabel hubungan antarbar Gantt pada ujung sesuai FS/SS/FF/SF dengan warna berbeda; 19 uji lolos, empat tipe dan dua skala teruji pada akun aktif, edit bar tetap berfungsi, hubungan bertahan setelah muat ulang, pekerjaan uji dihapus.

- [x] Tambahkan ID pekerjaan dan kolom Predecessor FS/SS/FF/SF; 15 uji lolos, keempat hubungan, pilihan jenis, perubahan tanggal berantai, penyimpanan ulang dan penolakan siklus teruji melalui akun aktif; pekerjaan uji dihapus.

- [x] Jadwal per sketsa: daftar judul sketsa di sisi kiri, masing-masing menyimpan jadwal sendiri; 7 uji lolos dan teruji di browser (daftar, perpindahan sketsa, penyimpanan per sketsa).


- [x] Tambahkan halaman Jadwal privat dengan isian WBS, tabel/Gantt berwarna, ceklis subpekerjaan, progres otomatis, dan garis hari berjalan; 4 uji lolos, progres 50% tersimpan setelah muat ulang dan berubah 100% lewat ceklis, kalender terpilih, bar tampil, serta pekerjaan uji dihapus.

- [x] Tambahkan Jendela Dinamis 50 cm, ujung tarik tanpa batas, jarak pembatas/toleransi; 7 uji lolos, pemasangan 50 cm dan panjang 1200 cm tersimpan setelah muat ulang.

- [x] Sesuaikan legenda bawah otomatis 5–6 kolom dengan jarak rapat; 12 pengujian lolos dan build OK. Pemeriksaan visual akhir belum selesai karena berkas sesi pengujian sementara hilang.

- [x] Tambahkan pilihan posisi Legenda Arsitektural Kanan (2 kolom, default) dan Bawah (4 kolom); 10 uji lolos.

- [x] Batasi pangkasan Arsitektural tepat ke bingkai jendela tanpa mengurangi dinding/kolom di luarnya; 13 uji lolos dan slide dengan sesi aktif menunjukkan potongan tepat sama dengan bingkai serta dinding berdekatan tetap utuh.

- [x] Pangkas dinding di jendela Arsitektural, alas putih dan bayangan gradual 45° 20 cm di bawah bayangan dinding; 11 uji lolos dan keempat style teruji di browser dengan akun aktif.

- [x] Besarkan teks legenda Arsitektural dua kali dan susun dua kolom vertikal; delapan uji lolos, dua kolom tanpa tabrakan teks serta keempat style dan kondisi mati teruji di browser.

- [x] Tambahkan subceklis Legenda Arsitektural default mati, nomor ruang dan legenda kanan tanpa kotak sesuai warna style, nama/elevasi level serta luas ruang; tiga uji lolos, penyimpanan setelah muat ulang dan keempat style teruji di browser dengan sesi aktif.

- [x] Urutkan nomor detail dari elevasi lantai terendah; penambahan di LT 1 menggeser LT 2, furniture tetap utuh setelah muat ulang, dan nomor Presentasi teruji dengan sesi aktif; empat uji lolos.

- [x] Terangkan gradien latar style Bata 30% pada seluruh gradien lalu sudut kiri atasnya 50% lagi; terukur di browser: sudut rgb(228,209,211) dan ujung rgb(149,120,123).

- [x] Tambahkan style Bata: gradien merah bata sesuai referensi, dinding emas, garis/dimensi/teks/pintu putih; pilihan bertahan setelah muat ulang dan slide detail teruji di browser dengan denah contoh.

- [x] Putihkan grid dan pintu Arsitektural Coklat/Biru; ketiga style teruji pada slide 13 cadangan Cloud terbaru, 88 pintu memakai kusen 50 mm, kedalaman mengikuti material dinding, dan daun 40 mm.

- [x] Tambahkan pilihan style Arsitektural Tosca/Coklat/Biru per kotak detail, gradien sesuai referensi dan teks putih untuk Coklat/Biru; ketiga pilihan tersimpan setelah muat ulang dan slide 13 teruji tanpa kesalahan.

- [x] Perbaiki beban filter bayangan slide 13 Detail 2 LT 1 proyek GEDUNG TMM RS SOERADJI (13 Okt) SIMULASI: enam lapisan dengan batas area detail; 18 uji geometri lolos.
- [x] Verifikasi cadangan Cloud terbaru 13 Oktober 03:58:58 UTC tanpa mengubah opsi detail: slide 13 Arsitektural terbuka di tampilan biasa dan layar penuh, tanpa fallback atau kesalahan.

- [x] Diagnosis dan perbaiki slide Arsitektural LT 1 dan LT 2 proyek GEDUNG TMM RS SOERADJI (13 Okt) SIMULASI; menunggu ekspor data terbaru dari pengguna karena cadangan Cloud terakhir 22 September tidak memuat proyek 13 Oktober. (terverifikasi: 95/95 slide terbuka, seluruh slide arsitektural LT 1–5 tampil)

- [x] Naikkan kecerahan gradien lantai Arsitektural di kiri atas 30% lagi; terukur pada denah lokal di browser.

- [x] Naikkan lagi kecerahan puncak gradien radial latar Arsitektural 50% di kiri atas; terukur pada denah lokal di browser.

- [x] Naikkan lagi kecerahan gradien radial latar Arsitektural di kiri atas sebesar 50%; terukur pada denah lokal di browser.

- [x] Terangi lagi gradien radial latar Arsitektural 30% dan gradien lantai 20% di kiri atas; teruji pada denah lokal di browser.

- [x] Sesuaikan gradien radial latar/lantai Arsitektural dan furniture lebih terang dengan bayangan gradual 15 cm; teruji pada denah lokal di browser, 13 pengujian geometri lolos.

- [x] Perbaiki sisa kegagalan membuka slide Arsitektural dan uji denah kompleks serta geometri fallback.

- [x] Perbaiki Response notifikasi saat sesi hilang/kedaluwarsa; sesi valid, hilang, dan tidak valid teruji tanpa layar kosong, serta penandaan feed tanpa sesi ditolak.

- [x] Perbaiki slide Arsitektural gagal dibuka akibat geometri bayangan dinding miring; 17 pengujian lolos dan slide berhasil dibuka di browser.

- [x] Sesuaikan Detail Arsitektural: lantai gradien menyatu, garis tanpa material tipis, luas dan dimensi, bukaan pintu pada dinding/bayangan, kolom menyatu, bevel 2 cm, bayangan 150 cm gradual, dan latar penuh lebih terang; verifikasi.

- [x] Tambahkan ceklis Arsitektural eksklusif pada Pendetailan dan denah gradien dengan dinding putih serta bayangan lembut 45°; verifikasi tampilan dan penyimpanan.

- [x] Tambahkan luas material per lantai setelah daftar ruang pada Lokasi Outline Spesifikasi, dengan rumus dan sambungan halaman yang konsisten.

- [x] Tambahkan Tangga Bebas: jalur garis bersudut bebas, offset lebar, bordes otomatis, edit dan simpan.
- [x] Sinkronkan geometri Tangga Bebas ke denah/detail Presentasi dan ekspor/impor serta uji hasilnya.

- [x] Kecualikan perimeter ruang tanpa garis dinding dari simbol material dan luas dinding pada legenda Detail serta Outline Spesifikasi.

- [x] Tambahkan subkolom Luas pada Lokasi Outline Spesifikasi untuk total Lantai, Dinding, dan Plafon seluruh level.

- [x] Tambahkan lingkaran warna dan total luasan lantai, dinding, serta plafon pada legenda Slide Detail.

- [x] Hilangkan simbol segitiga arah panel dari tengah jendela pada Sketsa dan Presentasi.

- [x] Atur dimensi luar ruang di bawah 400 mm yang berurutan pada jalur berulang 400, 550, dan 700 mm dari kotak detail.

- [x] Tambahkan pintu lipat satu/dua sisi, arah kiri/kanan, jumlah daun, lebar 800 cm, dan notasi 45° di seluruh tampilan serta DXF.
- [x] Koreksi geometri pintu lipat agar panjang daun tetap nyata dan sisa lebar bukaan menjadi jeda di kusen seberang atau di tengah.

- [x] Perbaiki penambahan material Pekerjaan Dasar dan Fasad di Rincian per Level agar pilihan baru bertahan setelah disimpan.

- [x] Tambahkan mode Plafon pada Pendetailan, kode material kustom, Pekerjaan Dasar/Fasad umum, dan perluas Outline Spesifikasi.

- [x] Cegah permintaan notifikasi saat sesi belum siap dan hentikan pengulangan pemanggilan akibat perubahan fungsi render.

- [x] Sambungkan tabel Outline Spesifikasi antarhalaman berdasarkan tinggi tersedia, termasuk sambungan daftar lantai dengan keterangan material yang diulang.

- [x] Tambahkan ceklis per sketsa untuk Outline Spesifikasi dan slide tabel material setelah Estimasi Biaya; gunakan tabel lanskap penuh, pembagian halaman adaptif, teks multiline, serta daftar ruang dipisahkan koma dan sejajar per lantai.

- [x] Tambahkan deskripsi dan produk yang dapat diperbarui pada setiap material di pustaka akun.

- [x] Batasi tinggi tabel Rincian per Level, tambahkan gulir vertikal dan fill handle material, serta pudarkan dropdown yang belum dipilih.

- [x] Pasang kolom praktis pada ujung terbuka Dinding Solid dan Dinding standar 150 mm sesuai notasi materialnya.

- [x] Tambahkan mode Material pada Pendetailan dengan warna lantai, kode bidang, dan legenda Slide Detail.

- [x] Pisahkan Tabulasi dan List Material; simpan pustaka material per akun dengan gambar.
- [x] Letakkan Rincian per Level sepanjang lebar halaman di bagian bawah dan hubungkan pilihan material tiap ruang ke pustaka.

- [x] Tebalkan garis Dinamic Furniture menjadi 1,5, pusatkan tag per item, dan tambahkan kategori furniture yang dapat dikelola.

- [x] Terapkan notasi tangga arsitektural pada slide Denah/Detail: potong 1 m, garis 45°, bagian atas putus-putus, arah naik/turun, bordes, dan lantai tipikal tengah.

- [x] Atur furniture di bawah dinding, beton, grid, pintu, dan dimensi pada slide denah/detail; tambahkan name tag serta jadikan label ruang lapisan teratas.

- [x] Tetapkan tebal garis Dinamic Furniture sebesar 1,5 agar tidak berubah saat dimensinya diubah.

- [x] Cegah tumpang tindih dimensi luar pendek berurutan, gunakan muka material saja, putihkan Detail saat Dimensi interior aktif, dan putihkan isi kolom praktis standar 150 mm.

- [x] Ukuran dalam hanya bentang bersih, geser ukuran pendek hanya saat berurutan; proyeksi ukuran luar memakai kedua permukaan material dinding.

- [x] Tambahkan Dinding standar 150 mm pada Pick Material dengan hatch dinding solid dan kolom praktis beton berfinishing 15 mm.

- [x] Tambahkan ceklis Dimensi Interior dan tampilkan ukuran bersih ruang serta bukaan pada Slide Detail dengan area tayang melebar 1 m.

- [x] Tambahkan editing pintu dan jendela terpasang: seleksi, orientasi, slider ukuran, dan drag kedua ujung.

- [x] Tambahkan konversi massal material asal menjadi material terpilih pada level aktif di Pick Material.

- [x] Tambahkan input ΔX/ΔY untuk menggeser seluruh garis potong terpilih seperti geser titik.

- [x] Kelompokkan slide Rincian per Level berdasarkan zona fungsi, tampilkan luasan per fungsi per level, dan urutkan koefisien 1 sebelum 0.

- [x] Tempatkan beton semua ketebalan di atas material dinding lain pada denah, detail, key plan, dan potongan.

- [x] Satukan bidang dan garis tepi dinding beton/solid pada sudut, sambungan T, dan persilangan di Denah, Detail, serta key plan.

- [x] Dimensi ruang 1 m dan grid struktur 2 m pada sisi kiri, kanan, atas, dan bawah Slide Detail.
- [x] Area Slide Detail tepat mengikuti kotak detail; teks dimensi ruang dan ketebalan garis dimensi diperkecil.
- [x] Titik proyeksi dimensi ruang hanya berasal dari pertemuan garis yang membentuk sudut siku-siku.
- [x] Garis dimensi kanan/bawah diteruskan melewati teks dan proyeksi ruang diikat ke garis grid terdekat serta grid di antaranya.
- [x] Tambahkan halaman Detail di antara Sketsa dan Tabulasi, dikelompokkan per judul sketsa.
- [x] Tampilkan setiap kotak pendetailan sebagai bidang kerja yang sesuai dengan kotak di Sketsa.
- [x] Tambahkan katalog furniture dasar dan impor gambar ke tengah detail.
- [x] Tambahkan drag, rotasi snap 5°, skala sudut, seleksi, dan hapus furniture.
- [x] Simpan furniture per akun/sketsa/detail dan sertakan dalam ekspor-impor.
- [x] Sinkronkan furniture ke Slide Detail Presentasi dan verifikasi interaksi.
- [x] Tambahkan layar penuh, zoom dua jari/trackpad, pan, dan reset tampilan pada bidang Detail.
- [x] Tambahkan seleksi banyak serta aksi geser, hapus, salin, dan tempel bersama.
- [x] Dukung clipboard furniture lintas detail dan lintas proyek dalam akun yang sama.
- [x] Simpan furniture impor ke pustaka akun dan tampilkan kembali pada panel seluruh proyek.
- [x] Tambahkan ceklis Furniture pada Pendetailan untuk mengatur kemunculan di Slide Detail.
- [x] Verifikasi seluruh interaksi pada desktop dan layar sentuh serta tampilan Presentasi.
- [x] Tambahkan ceklis Fungsi per garis potong dan simpan bersama proyek.
- [x] Tambahkan slide Potongan Fungsi setelah Stacking Diagram.
- [x] Render pelat 50 cm, zona gabungan, dinding luar, aksonometri, dan diagram cincin per lantai.
- [x] Verifikasi urutan slide, tampilan desktop, dan layar kecil.
- [x] Hitung komposisi fungsi dari seluruh ruang per lantai dan tambahkan akumulasi semua lantai.
- [x] Tampilkan seluruh legenda Potongan Fungsi tanpa gulir vertikal atau teks terpotong.
- [x] Tambahkan seleksi marquee untuk mengubah material banyak garis sekaligus pada level aktif.
- [x] Atur teks dimensi ruang 25% lebih kecil dari teks grid dan tipiskan garis dimensi 50%.
- [x] Input dimensi katalog furniture dalam mm, tambah template Dinamic furniture 1000 × 1000 mm dan hilangkan skala langsung di denah.
- [x] Tambahkan tabel furniture dengan ukuran, jumlah, harga dan duplikasi; tautkan posisi furniture ke ruang untuk denah Presentasi sesuai ceklis.
- [x] Tambahkan ceklis kirim ke presentasi, slide Furniture per kategori dan level, serta elemen konstruksi pada gambar Detail.


- [x] Slide 13 Detail 2 LT 1 gagal di Galaxy Tab (Chrome): bevel dinding jadi bitmap, union dinding di-cache

- [x] Tombol Unduh PDF di kanan atas jadwal dan Kurva S; cetak A4 lanskap muat kiri-kanan, multi halaman.

- [x] Tombol Salin sketsa juga menyalin jadwal dan pengaturan tampilannya ke sketsa hasil salinan.

- [x] Tambahkan style Arsitektural Oranye Terang: tone dan sifat sama persis dengan Monokrom, dinding oranye bata; 3 uji lolos, 118 uji total lolos, warna dinding terukur di pratinjau.

- [x] Gradien lantai style Monokrom dan Oranye Terang: sudut kiri atas putih, sudut kanan bawah tetap abu muda; 4 uji lolos, warna terukur pada slide.
