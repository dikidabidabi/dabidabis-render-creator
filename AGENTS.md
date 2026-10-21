# Architecture decisions

- Architectural settings persist per area; plans stay centered/full-size; legends share numbering/ink. Bottom legends select the largest fitted layout and its gaps. Walls subtract openings before shadows. Window cuts/notation share windowPlanGeometry bounds; bases share wall shadows. DoorNotation retains dimensions.
- Architectural clipping rounds coordinates, rejects invalid bands and preserves geometry on failure; shadow strips avoid clipping unions, free-stair unions fall back safely, and detail slides retry without Architectural mode. Wall shadows render as cached viewport-bounded bitmaps (max 2048 px) with geometry-cached wall unions; wall fills omit bevel computation and rendering to reduce Android tablet graphics load.

- Free stairs store a polyline and width-offset side, with shared free-stair-geometry generating flights and automatic bend landings for Sketch and Presentation; this keeps arbitrary turns and elevations consistent across views and file transforms.

- Notification polling requires a session token and stable dependencies to prevent unauthorized/repeated requests.
- Background notification reads and feed-seen writes verify bearer claims through notification-session.server before any user-scoped RLS query; unavailable sessions return serializable empty/no-op results rather than thrown Responses so auth races cannot blank the app.
- Tabel Rincian per Level memakai area gulir vertikal mandiri dan fill handle material hanya menyalin sepanjang kolom serta level yang sama agar pengisian massal tidak bocor ke data lain.
- Doors/windows use tool-local editing; dynamic windows keep A fixed and share windowDividerFractions across Sketch/Presentation so spacing and end tolerance stay consistent.
- Pintu lipat menyimpan mode satu/dua sisi, arah sisi tunggal, dan jumlah panel; panjang fisik daun dipertahankan saat diproyeksikan 45° sehingga sisa bukaan berada di kusen seberang atau di tengah, konsisten di Sketsa, Detail, Presentasi, dan DXF.
- Dimensi interior Slide Detail mengukur bentang bersih permukaan-ke-permukaan tanpa interval ketebalan dinding, sejajar dinding acuan, dan menggeser 150 mm hanya rangkaian interval di bawah 200 mm yang berdampingan; dimensi luar hanya memproyeksikan muka material dan menempatkan rangkaian interval di bawah 400 mm pada jalur berulang 400/550/700 mm dari kotak detail, area tayang meluas 1 m, serta denah menjadi putih polos saat opsi aktif.
- Ujung terbuka dan pertemuan Dinding Solid/standar 150 mm memakai kolom praktis 150 × 150 mm; solid hitam, standar putih dengan finishing 15 mm.
- Furniture Detail disimpan bersama kotak detail dengan ID ruang, kategori, dan posisi relatif terhadap ruang; daftar kategori disimpan per akun, ukuran katalog/tabel dalam mm dikonversi memakai skala sketsa agar ikut bergeser ketika ruang berubah, sementara ceklis per kotak mengendalikan kemunculan di Presentasi.
- Furniture recap uses per-sketch showFurnitureSlide, grouping all detail furniture by category and elevation.
- Shared renumberDetailAreas orders labels by elevation on sketch loads/updates and Detail/Presentation reads, preserving IDs and furniture links.
- Furniture renders before notation and room labels; Architectural mode uses scale-aware layered alpha shadows and image tint preserving transparency and linework, while other modes remain unchanged.
- Notasi tangga Slide Denah/Detail memakai bidang potong 1 m dengan garis batas 45°, bagian di atas bidang potong putus-putus, sisi dalam tegas, arah naik/turun mengikuti bordes, dan tangga tipikal tengah ditampilkan utuh.
- Pustaka material beserta nama, gambar, deskripsi, dan produk tersimpan per akun melalui penyimpanan proyek bersama, sedangkan pilihan material tiap ruang tersimpan pada layer sketsa dengan ID material agar perubahan data tetap tersinkron.
- Mode Material pada setiap kotak detail memakai ID material ruang untuk warna dan kode lantai/dinding, dengan legenda pada rel kanan Slide Detail; nilai awalnya nonaktif agar presentasi lama tidak berubah.
- Slide Outline Spesifikasi diaktifkan per sketsa dari kepala Material Rincian per Level, menggabungkan pemakaian pustaka material per jenis, memakai tabel A3 lanskap selebar bidang, serta mengalirkan baris lintas halaman menurut tinggi tersedia sambil mengulang identitas material pada sambungan daftar ruang agar tidak terpotong atau menyisakan halaman kosong.
- Pekerjaan Dasar dan Fasad disimpan sebagai pilihan material umum per sketsa, terpisah dari material ruang; Fasad dibagi Barat, Timur, Utara, dan Selatan.
- Mode Plafon per kotak detail saling eksklusif dengan mode Material dan memakai kode material bersama yang sama dengan Outline Spesifikasi.
- Symbols, legend and spec wall areas share roomWallSpans to merge same-level lined perimeter only; roomWallSurfacePoint anchors symbol tips using resolved wall half-thickness so they touch the room-facing surface.
- Outline Specification per-level location areas and all-level totals share specMaterialArea; location fragments retain the full level area and pagination measures the displayed room-and-area text to prevent clipping.
