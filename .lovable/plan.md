# Edit Vertex Bangunan pada Model 3D

## Tujuan
Menambahkan mode edit pada halaman Model 3D untuk bangunan yang berasal dari Sketsa. Pengguna memilih obyek ruang/dinding atau pelat lantai, memilih vertex, lalu menggesernya dengan gizmo bersumbu X, Y, atau Z dan snap setiap 50 cm. Perubahan langsung disimpan kembali ke Sketsa.

## Alur pengguna
1. Aktifkan **Edit bangunan** pada halaman Model 3D.
2. Klik obyek ruang/dinding atau pelat lantai untuk memilihnya.
3. Vertex obyek tampil sebagai titik seleksi; klik satu vertex.
4. Gizmo X/Y/Z tampil pada vertex terpilih.
5. Tarik salah satu sumbu; perpindahan terkunci pada sumbu itu dan dibulatkan per 0,5 m.
6. Label di dekat vertex menampilkan sumbu dan jarak perpindahan dalam meter.
7. Saat drag selesai, bentuk 3D dan data Sketsa diperbarui otomatis.

## Cakupan
- Obyek yang dapat diedit: ruang/dinding dari layer Sketsa dan pelat lantai.
- X dan Y pada alat mengikuti dua arah horizontal denah; Z adalah arah vertikal.
- Perubahan horizontal mengubah koordinat vertex pada canvas Sketsa.
- Perubahan vertikal mengubah elevasi level terkait agar tetap dapat direpresentasikan oleh data Sketsa 2D.
- Pelat dengan lubang mendukung pemilihan vertex batas luar dan batas lubang.
- Obyek tersembunyi, lahan, taman, void, atap, bangunan OSM, dan obyek non-Sketsa tidak dapat diedit pada tahap ini.

## Tampilan dan kontrol
- Obyek terpilih diberi outline yang jelas.
- Vertex terpilih dibedakan dari vertex lain.
- Gizmo memakai konvensi warna sumbu yang familiar dan tidak ikut mengubah ukuran saat kamera bergerak.
- Orbit kamera dinonaktifkan sementara ketika gizmo sedang ditarik agar gerakan tidak berebut dengan kamera.
- Tombol batal/keluar edit menghapus seleksi tanpa mengubah data.

## Sinkronisasi dan keamanan data
- Perubahan hanya dikomit saat drag selesai untuk menghindari penulisan terus-menerus.
- Penyimpanan membaca versi proyek terbaru, memutasi hanya obyek terkait, lalu menulis melalui penyimpanan proyek per akun.
- Halaman Sketsa menerima pembaruan penyimpanan sehingga perubahan terlihat otomatis tanpa perlu memuat ulang.
- `updatedAt`, urutan vertex, dan properti obyek lain tetap dipertahankan.

## Detail teknis
- Gunakan `TransformControls` dalam mode translate dengan `translationSnap={0.5}`.
- Konversi koordinat: dunia X → Sketsa x; dunia Z → Sketsa y; dunia Y → elevasi level.
- Pisahkan mesh interaktif dari renderer geometri agar callback seleksi tidak mengubah pipeline visual lain.
- Tambahkan helper penyimpanan bersama yang melakukan fresh-read, patch satu sketch, `setProjectItem`, lalu mengirim notifikasi perubahan.
- Tambahkan listener perubahan penyimpanan pada halaman Sketsa dengan perlindungan agar state lokal yang belum tersimpan tidak tertimpa.

## Verifikasi
- Uji ruang/dinding: pilih obyek, pilih vertex, geser horizontal 0,5 m, dan pastikan canvas Sketsa berubah.
- Uji pelat: geser vertex batas luar dan vertex lubang.
- Uji Z: elevasi level berubah per 0,5 m dan seluruh geometri level mengikuti.
- Pastikan label perpindahan benar, orbit berhenti saat drag, reload mempertahankan perubahan, dan tidak ada error tampilan/build.
- Periksa tampilan desktop dan layar sempit agar panel edit tidak menutupi area utama.
