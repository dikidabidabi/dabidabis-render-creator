# Koreksi Dimensi Interior Slide Detail

## Perubahan
- Jadikan permukaan kedua sisi dinding sebagai titik ukur, sehingga ketebalan material dinding—termasuk ukuran 150 mm pada contoh—ikut muncul sebagai interval dimensi.
- Bentuk setiap rantai dimensi dari arah dinding acuannya: garis ukur sejajar dinding dan garis bantu tegak lurus, tanpa mengikuti diagonal akibat pergeseran titik sudut.
- Pertahankan posisi dasar teks dan garis dimensi 500 mm ke dalam dari permukaan dinding.
- Untuk interval kurang dari 200 mm yang berurutan dan teksnya berpotensi bertumpuk, tempatkan secara bergantian: interval pertama dan ketiga digeser 150 mm menjauhi dinding dari posisi dasar, interval kedua tetap pada posisi dasar, lalu pola diulang.
- Pertahankan ukuran teks serta ketebalan garis yang sama dengan dimensi ruang yang sudah ada.

## Aturan Teknis
- Perhitungan hanya memakai dinding dan material pada level Slide Detail aktif.
- Nilai tetap ditampilkan dalam milimeter dan titik ukur yang sama dideduplikasi dengan toleransi kecil.
- Pergeseran 150 mm hanya berlaku pada dimensi pendek kurang dari 200 mm; dimensi lain tetap di jalur 500 mm.

## Verifikasi
- Uji pertemuan dinding 150 mm untuk memastikan kedua permukaannya menghasilkan ukuran 150.
- Uji dinding miring untuk memastikan garis ukur tetap sejajar dan garis bantu tegak lurus terhadap dinding acuan.
- Uji tiga interval 100 mm berdekatan untuk memastikan susunan jalurnya bergantian 650 mm, 500 mm, dan 650 mm dari dinding tanpa teks bertumpuk.
