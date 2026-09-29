# Editing pintu dan jendela terpasang

## Perubahan
- Tambahkan mode **Edit** pada alat Pintu dan Jendela untuk memilih elemen yang sudah terpasang di lantai aktif.
- Saat elemen dipilih, tampilkan penanda seleksi, pegangan pada kedua ujung, dan simbol orientasi langsung di sketsa.
- Simbol orientasi menyediakan empat kombinasi: engsel kiri/kanan serta bukaan ke dalam/luar ruang; klik simbol akan mengganti orientasi dan langsung memperbarui gambar.
- Untuk pintu geser, kontrol orientasi menyesuaikan arah geser kiri/kanan; pintu dua daun tetap bergerak berlawanan.
- Tambahkan slider ukuran pada mode edit. Perubahan slider mempertahankan salah satu ujung dan mengubah ujung lainnya sepanjang sumbu bukaan.
- Izinkan salah satu pegangan ujung ditarik untuk memanjangkan atau memendekkan pintu/jendela; gerak tetap mengikuti garis dinding dan ukuran otomatis diperbarui.
- Batasi ukuran sesuai aturan yang sudah ada: pintu 70–200 cm dan jendela 50–600 cm.

## Perilaku data
- Simpan orientasi jendela secara kompatibel dengan data lama; jendela lama memperoleh orientasi bawaan tanpa berubah posisi.
- Setiap perubahan memakai riwayat undo yang sudah ada dan hanya menyentuh elemen terpilih pada lantai aktif.
- Setelah edit selesai, tampilan Sketsa dan semua tampilan turunan tetap membaca geometri serta orientasi terbaru.

## Teknis
- Tambahkan state seleksi dan drag endpoint khusus pintu/jendela agar tidak bentrok dengan penempatan baru, hapus, pan, atau gestur zoom.
- Gunakan kombinasi urutan titik A/B untuk sisi engsel dan tanda vektor normal untuk sisi dalam/luar.
- Sinkronkan panel edit dengan properti elemen terpilih, termasuk tipe, jumlah daun, arah, dan ukuran.
- Verifikasi kompilasi serta interaksi pemilihan, perubahan orientasi, slider, drag kedua ujung, undo, dan tampilan layar sentuh.
