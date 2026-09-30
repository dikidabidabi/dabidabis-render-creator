# Kode dan Legenda Material pada Slide Detail

## Hasil yang dibangun
- Tambahkan ceklis **Material** pada setiap kotak alat Pendetailan; kotak baru dan proyek lama bernilai nonaktif secara bawaan.
- Saat aktif, warna bidang ruang pada Slide Detail dibedakan berdasarkan material **lantai** yang dipilih di Rincian per Level, bukan warna zona fungsi.
- Beri setiap material lantai yang terpakai kode `L1`, `L2`, dan seterusnya; tampilkan kode di dalam simbol lingkaran pada masing-masing area lantai.
- Beri setiap material dinding yang terpakai kode `D1`, `D2`, dan seterusnya; tampilkan simbol segitiga bernomor pada tiap sisi ruang yang memiliki material dinding, mengarah ke bidang dinding seperti contoh.
- Geser komposisi gambar detail ke kiri saat mode Material aktif dan sediakan legenda vertikal di sisi kanan dari atas hingga bawah, terpisah untuk **Lantai** dan **Dinding**.
- Legenda memuat kode, warna, nama material, dan contoh gambar material jika tersedia; material yang belum dipilih tidak diberi kode.

## Aturan tampilan
- Warna material dibuat konsisten dari identitas material dan tetap terbaca di bawah garis teknis.
- Notasi dinding, pintu, jendela, grid, dimensi, furniture, dan label ruang tetap memakai urutan lapisan yang sudah berlaku.
- Label ruang tetap menjadi lapisan paling atas; kode material ditempatkan agar tidak menutupi label ruang sebisa mungkin.
- Mode Dimensi Interior dan Hatch lantai tetap mempertahankan aturan putih/hatch yang sudah ada; mode Material hanya mengganti warna bidang jika kedua mode tersebut tidak aktif.

## Teknis
- Tambahkan properti `showMaterials` pada data kotak detail, normalisasi data lama, nilai awal `false`, dan kontrol di panel Pendetailan.
- Baca pustaka material akun serta `roomMaterials` tiap ruang di renderer Presentasi.
- Bentuk daftar kode unik hanya dari material yang benar-benar dipakai pada ruang di dalam kotak detail.
- Gunakan bidang ruang untuk kode lantai dan setiap sisi poligon ruang untuk penunjuk kode dinding.
- Pertahankan ekspor, impor, penggabungan, dan perubahan skala melalui struktur kotak detail yang sudah ada.

## Verifikasi
- Uji kotak detail baru tidak mengaktifkan Material secara otomatis.
- Uji warna lantai, kode lingkaran, kode segitiga tiap bidang dinding, dan legenda dengan beberapa material berbeda.
- Uji Slide Detail saat Material mati, saat Hatch aktif, dan saat Dimensi Interior aktif agar perilaku lama tidak berubah.
- Periksa bahwa legenda kanan tidak bertumpuk dengan key plan dan seluruh gambar tetap terbaca pada layar presentasi.
