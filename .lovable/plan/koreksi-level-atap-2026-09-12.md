# Koreksi Level Atap

## Perubahan
- Tampilkan atap hanya pada level tempat atap digambar di kanvas sketsa.
- Tampilkan atap hanya pada slide denah untuk level tersebut, tanpa bayangan atap dari level lain.
- Pada slide potongan, gunakan elevasi level pemilik atap dan abaikan data atap yang tidak lagi memiliki level valid.
- Hapus data atap ketika level pemiliknya dihapus agar tidak berpindah ke level lain.

## Verifikasi
- Pastikan pemeriksaan TypeScript dan build aplikasi berhasil.
- Periksa tampilan denah dan potongan untuk memastikan atap mengikuti level asalnya.
