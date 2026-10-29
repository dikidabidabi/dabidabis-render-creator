# Architecture decisions

- Build scripts preserve NODE_OPTIONS and reserve 6 GiB heap for client/SSR/Nitro bundling; runtime bundling is unchanged.

- Schedules are owner/sketch scoped; migrate legacy arrays to active sketch and copy schedules/views on duplication. taskPredecessors supports legacy links/UUID arrays: maximum start bound, preserved duration, validated edges/cycles, signed CPM offsets. Bars/cables share bounds/visible rows/stable IDs. Persist folding/CPM/slack. Date fills stay atomic in one column/visible rows; reject invalid/predecessor-controlled dates. CPM uses leaf completion; S curves duration-weighted dated progress. Actual bars split blue/red at due; explicit finish overrides first 100% entry, else today; retain delay bars without actual start.

- Architectural settings persist per area; plans remain centered/full-size; legends share numbering/ink and bottom layout maximizes fit. Subtract openings before wall shadows. Window cuts/notation share windowPlanGeometry bounds; short base and long frame/mullion shadows share wall darkness. DoorNotation retains dimensions.
- Architectural clipping rounds coordinates, rejects invalid bands and preserves geometry on failure; shadow strips avoid clipping unions, free-stair unions fall back safely, and detail slides retry without Architectural mode. Wall shadows render as cached viewport-bounded bitmaps (max 2048 px) with geometry-cached wall unions; wall fills omit bevel computation and rendering to reduce Android tablet graphics load.

- Free stairs store a polyline and width-offset side, with shared free-stair-geometry generating flights and automatic bend landings for Sketch and Presentation; this keeps arbitrary turns and elevations consistent across views and file transforms.

- Notification polling requires a session token and stable dependencies; background reads and feed-seen writes verify bearer claims through notification-session.server before user-scoped RLS queries, returning serializable empty/no-op results on unavailable sessions so auth races cannot blank the app.
- Tabel Rincian per Level memakai area gulir vertikal mandiri dan fill handle material hanya menyalin sepanjang kolom serta level yang sama agar pengisian massal tidak bocor ke data lain.
- Doors/windows use tool-local editing; dynamic windows keep A fixed and share windowDividerFractions across Sketch/Presentation so spacing and end tolerance stay consistent.
- Pintu lipat menyimpan mode satu/dua sisi, arah sisi tunggal, dan jumlah panel; panjang fisik daun dipertahankan saat diproyeksikan 45° sehingga sisa bukaan berada di kusen seberang atau di tengah, konsisten di Sketsa, Detail, Presentasi, dan DXF.
- Dimensi interior Slide Detail mengukur bentang bersih permukaan-ke-permukaan tanpa interval ketebalan dinding, sejajar dinding acuan, dan menggeser 150 mm hanya rangkaian interval di bawah 200 mm yang berdampingan; dimensi luar hanya memproyeksikan muka material dan menempatkan rangkaian interval di bawah 400 mm pada jalur berulang 400/550/700 mm dari kotak detail, area tayang meluas 1 m, serta denah menjadi putih polos saat opsi aktif.
- Ujung terbuka dan pertemuan Dinding Solid/standar 150 mm memakai kolom praktis 150 × 150 mm; solid hitam, standar putih dengan finishing 15 mm.
- Detail furniture stores room ID, category and room-relative position with each detail box; categories are account-scoped, catalog/table mm convert via sketch scale, and per-box visibility controls Presentation. Per-sketch showFurnitureSlide groups recap by category/elevation so room edits preserve placement and reporting.
- Shared renumberDetailAreas orders labels by elevation on sketch loads/updates and Detail/Presentation reads, preserving IDs and furniture links.
- Furniture renders before notation and room labels; Architectural mode uses scale-aware layered alpha shadows and image tint preserving transparency and linework, while other modes remain unchanged.
- Notasi tangga Slide Denah/Detail memakai bidang potong 1 m dengan garis batas 45°, bagian di atas bidang potong putus-putus, sisi dalam tegas, arah naik/turun mengikuti bordes, dan tangga tipikal tengah ditampilkan utuh.
- Account material libraries store names/images/descriptions/products in shared project storage; room selections store material IDs on sketch layers to keep edits synchronized.
- Mode Material pada setiap kotak detail memakai ID material ruang untuk warna dan kode lantai/dinding, dengan legenda pada rel kanan Slide Detail; nilai awalnya nonaktif agar presentasi lama tidak berubah.
- Per-sketch Outline Specification toggles in the level-material header; aggregate library usage by type in full-width A3 landscape tables, paginate by available height, and repeat material identity on room-list continuations to avoid clipping or blank pages.
- Pekerjaan Dasar dan Fasad disimpan sebagai pilihan material umum per sketsa, terpisah dari material ruang; Fasad dibagi Barat, Timur, Utara, dan Selatan.
- Mode Plafon per kotak detail saling eksklusif dengan mode Material dan memakai kode material bersama yang sama dengan Outline Spesifikasi.
- Symbols, legend and spec wall areas share roomWallSpans to merge same-level lined perimeter only; roomWallSurfacePoint anchors symbol tips using resolved wall half-thickness so they touch the room-facing surface.
- Outline Specification per-level location areas and all-level totals share specMaterialArea; location fragments retain the full level area and pagination measures the displayed room-and-area text to prevent clipping.
- Schedule/S-curve PDF: window.print with print-schedule/print-scurve and fit-width zoom; A4 landscape, rows avoid breaks. Schedule separators use background strips at existing row/month boundaries to avoid PDF border rounding; never border unbordered cells.

- Schedule weights are stored only on root WBS tasks and derived recursively from all immediate siblings; weekly labels share task dates, plan colors and a shared due-date-split actual fill across Schedule and S-curve; S-curve uses leaf weights when supplied and duration weighting otherwise, so folding and edits cannot distort allocations.
