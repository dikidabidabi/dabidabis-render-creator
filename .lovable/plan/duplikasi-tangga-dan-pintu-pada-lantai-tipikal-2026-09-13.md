# Duplikasi Tangga dan Pintu pada Lantai Tipikal

## Hasil yang dibangun
- Tangga yang digambar pada level tipikal akan ditampilkan ulang pada setiap lantai salinan level tersebut.
- Setiap salinan tangga memakai tinggi lantai tipikal yang diinput, sehingga tinggi anak tangga dan posisi vertikalnya sesuai per lantai.
- Pintu pada level tipikal akan ditampilkan ulang pada semua lantai salinannya dengan posisi, arah bukaan, jumlah daun, dan ukuran yang sama.

## Perubahan tampilan potongan
- Gunakan daftar lantai hasil ekspansi tipikal sebagai dasar elevasi, bukan hanya satu rentang gabungan per level.
- Render tangga satu kali untuk setiap lantai tipikal, dengan dasar dan puncak mengikuti elevasi serta tinggi masing-masing salinan.
- Render pintu satu kali untuk setiap lantai tipikal dan tetap menerapkan aturan arah garis potong serta halangan dinding/kolom.
- Pertahankan ketebalan tangga, bordes, dan railing yang sudah ada pada setiap salinan.

## Data dan denah
- Geometri sumber tetap disimpan satu kali pada level tipikal; pengulangan hanya dilakukan saat membentuk tampilan lantai/potongan.
- Denah level tipikal tetap memakai satu geometri sumber yang mewakili seluruh lantai tipikal.

## Verifikasi
- Uji level tipikal dengan jumlah dan tinggi lantai berbeda.
- Pastikan tangga mencapai tinggi tiap lantai, pintu muncul di seluruh lantai tipikal, dan level non-tipikal tidak berubah.
- Jalankan pemeriksaan tipe, build, dan pemeriksaan tampilan potongan.
