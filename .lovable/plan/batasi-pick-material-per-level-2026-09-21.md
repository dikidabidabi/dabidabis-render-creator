# Batasi Pick Material per Level

## Perubahan
- Jadikan identitas material garis mencakup ID level, sehingga garis dengan koordinat sama di level berbeda tidak berbagi material.
- Migrasikan tanda material lama secara aman saat sketsa dibuka agar tetap muncul pada level yang sesuai.
- Ubah reset material agar hanya menghapus tanda pada level aktif, bukan seluruh level.
- Sesuaikan pembacaan material pada kanvas dan slide presentasi dengan identitas per-level.

## Verifikasi
- Uji dua level dengan garis yang bertumpuk: perubahan material di satu level tidak mengubah level lainnya.
- Pastikan slide denah/detail membaca material level masing-masing.
- Pastikan aplikasi berhasil dibangun tanpa error.

## Teknis
Kunci material akan dibentuk dari pasangan `levelId` dan ID segmen geometrinya. Dukungan kunci lama dipertahankan hanya untuk migrasi data yang sudah tersimpan.
