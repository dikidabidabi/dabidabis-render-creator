# Tiga Tipe Hubungan Ruang pada Presentasi

## Tujuan
Slide **Diagram Hubungan Ruang** pada setiap lantai membedakan tiga kondisi berdasarkan denah lantai yang sama.

## Perubahan
- Klasifikasikan setiap pasangan ruang yang berdekatan menjadi:
  1. **Hubungan langsung** — kedua ruang bersebelahan tanpa garis pembatas dan tanpa pintu.
  2. **Terhubung pintu** — terdapat pintu yang menghubungkan kedua ruang.
  3. **Bersebelahan (dinding)** — terdapat garis pembatas sketsa di antara kedua ruang.
- Gunakan prioritas **pintu → dinding → langsung**, sehingga satu pasangan ruang hanya memiliki satu tipe hubungan.
- Tampilkan hubungan langsung sebagai garis solid biru tua, sedikit lebih tebal daripada garis pintu hitam.
- Pertahankan hubungan pintu sebagai garis solid hitam tebal.
- Pertahankan hubungan dinding sebagai garis tipis putus-putus.
- Perbarui legenda dan ringkasan jumlah hubungan agar menampilkan ketiga kategori.

## Teknis
- Perluas pembentuk diagram agar menerima garis sketsa pada lantai aktif dan menguji apakah garis pembatas berada di antara perimeter dua ruang.
- Simpan tipe hubungan secara eksplisit pada setiap relasi, bukan hanya penanda pintu.
- Pastikan garis dari lantai lain tidak memengaruhi klasifikasi lantai yang sedang ditampilkan.
- Verifikasi tampilan slide presentasi dan kondisi aplikasi setelah perubahan.
