# Rencana: Tool "Jalan" + Integrasi Cluster Generator (Master Plan)

## Tujuan
Menambahkan tool **Jalan** di halaman Master Plan (mirror pola tool **Aksis**) dengan:
- Input **lebar jalan** (meter) — terlihat sebagai offset kiri/kanan dari centerline.
- Tool **fillet** untuk membulatkan belokan (radius dalam meter).
- Integrasi ke **Cluster Generator Master Plan**: bangunan menempel ke tepi jalan, berorientasi pada tangent jalan, dan otomatis terkelompok per area yang dibentuk oleh jaringan jalan.

## Komponen Baru
### 1. `src/lib/roads.ts`
- `type RoadSegment = { id, kind: "garis" | "tangent", points: Vec2[], widthM: number, filletM: number, createdAt }`.
- `roadCenterline(r)` — polyline tersampling (reuse `sampleTangent` dari `axes.ts`).
- `roadEdges(r)` — pasangan polyline kiri/kanan (offset ±width/2 sepanjang normal, dengan miter join terbatas) + lengkungan fillet di sudut.
- `roadCorridorPolygon(r)` — polygon koridor (gabungan kiri-kanan) untuk hit-test "area mana yang dipisah jalan".
- `pointInRoadCorridor(p, roads)` — utilitas untuk solver.
- `nearestRoadEdge(p, roads)` — kembalikan `{ point, tangent, normal, distance }` untuk snapping orientasi & gravitasi bangunan.
- `roadNetworkRegions(sitePoly, roads)` — bagi polygon Lahan oleh polyline jalan menjadi sub-region (pakai algoritma polygon clipping line cut: iteratif `splitPolygonByInfiniteLine` yang sudah ada, di-adaptasi untuk segmen polyline). Output: list of `{ polygon, id }`.

### 2. Tool UI di `src/routes/sketch.tsx` (mode `masterplan` saja)
Pola persis seperti tool **aksis**:
- Tambah `"jalan"` ke union `tool`, state `jalanSub: "garis" | "tangent" | "fillet"`.
- Input lebar (default 6 m) + input radius fillet (default 4 m).
- Draft drag (garis) / multi-klik + Selesai (tangent).
- Sub-tool **fillet**: klik pada vertex jalan untuk set radius.
- Tombol "Hapus semua" jalan.
- Persist via `sketch.roads` di tipe `Sketch` (mirror `axes`); sanitizer di loader.

### 3. Rendering canvas (denah sketsa)
- Centerline tipis putus-putus (abu gelap).
- Polygon koridor diisi semi-transparan (warna aspal `#3f3f46` @ 22%) + outline edge kiri/kanan solid.
- Lengkungan fillet di sudut.

### 4. Cluster Generator (`src/components/masterplan-cluster-dialog.tsx`)
- Tambah prop `roads: RoadSegment[]` (m-world coords).
- Di solver:
  - **Region partition**: hitung `roadNetworkRegions(lahan, roads)` → tiap region adalah cluster candidate.
  - **Assignment**: bagi blok ke region (round-robin per fungsi atau by hierarchy weight). Setiap blok diclamp di dalam region-nya.
  - **Gravitasi tepi**: tambah gaya tarik ringan ke `nearestRoadEdge` (jarak target = setback ½ blok + 1 m).
  - **Orientasi**: setelah relax, set `rotation` blok = sudut tangent edge terdekat (snap ke ±90°).
  - **Akses guarantee**: jika sebuah blok > 25 m dari road terdekat, dorong ke arah road terdekat region-nya.
- Render layout preview tetap (3 alternatif).

### 5. Wiring di `sketch.tsx` (mode masterplan)
- Saat membuka `MasterplanClusterDialog`, pass `roads={(sketch.roads ?? []).map(toMeters)}` di samping `avoidAxes`.

## Catatan teknis
- Reuse `sampleTangent` dari `@/lib/axes` untuk konsistensi kurva.
- Region splitting: pakai `splitPolygonByInfiniteLine` per **segmen polyline** secara berurutan; setelah split, buang region yang tumpang tindih koridor jalan.
- Tidak menyentuh halaman Sketsa biasa (tool hanya muncul saat `mode === "masterplan"`), mirror `aksis`.
- Tidak menyentuh file auto-generated.

## Estimasi
- `src/lib/roads.ts` baru (~250 baris).
- `src/routes/sketch.tsx` +~250 baris (tool UI + render + draft handler + sanitizer).
- `src/components/masterplan-cluster-dialog.tsx` +~120 baris (region partition + orientasi + gravitasi).
- Type `Sketch.roads?: RoadSegment[]`.

Mohon konfirmasi sebelum saya eksekusi.
