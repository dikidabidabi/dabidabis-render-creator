# Pintu lipat pada Sketsa dan Presentasi

## Perubahan
- Tambahkan jenis pintu **Lipat** di alat Pintu, berdampingan dengan Swing dan Geser.
- Sediakan mode lipatan **Satu Sisi** atau **Dua Sisi**; untuk satu sisi tersedia pilihan **Kiri** dan **Kanan**.
- Tambahkan pengaturan jumlah daun/lipatan. Pada dua sisi, jumlah genap dibagi seimbang; jumlah ganjil dibagi dengan selisih satu daun.
- Naikkan batas lebar khusus pintu lipat hingga **800 cm**, sedangkan batas pintu Swing dan Geser tetap mengikuti aturan saat ini.
- Gambar setiap daun pintu lipat pada denah dengan sudut 45° yang berselang-seling dan saling berlawanan seperti referensi.
- Terapkan notasi yang sama pada Sketsa, pratinjau pemasangan, halaman Detail, Slide Denah/Detail Presentasi, dan ekspor DXF.
- Perluas mode Edit agar pintu lipat terpasang dapat mengganti sisi lipatan, jumlah daun, dan lebar tanpa kehilangan perilaku seleksi, orientasi, drag ujung, salin-tempel, serta undo.

## Kompatibilitas
- Data pintu lama tetap dibaca sebagai Swing atau Geser tanpa perubahan tampilan.
- Data pintu lipat menyimpan mode sisi, arah sisi tunggal, dan jumlah daun secara eksplisit.
- Normalisasi membatasi nilai yang tidak valid dan mempertahankan geometri bukaan saat proyek diekspor, diimpor, digabung, atau diskalakan.

## Verifikasi
- Uji satu sisi kiri/kanan dan dua sisi dengan jumlah daun genap/ganjil.
- Uji lebar minimum hingga maksimum 800 cm, termasuk pengubahan lewat input, slider, dan drag ujung.
- Bandingkan tampilan Sketsa, Detail, Presentasi, serta hasil ekspor DXF dan pastikan proyek lama tetap normal.
