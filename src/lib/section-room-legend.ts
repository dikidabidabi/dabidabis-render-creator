// Legenda ruang potongan: dipakai bersama slide Potongan Prinsip Skematik dan
// Potongan 3D agar penomoran ruang selalu sama untuk garis potong yang sama.
export type SectionLegendSlice = { layerId: string; name: string; color: string; areaM2: number };
export type SectionLegendLevel = { name: string; slices: SectionLegendSlice[] };
export type SectionLegendRoom = {
  key: string; number: number; name: string; color: string;
  areas: number[]; areaM2: number; levelName: string; layerIds: string[];
};

/** Toleransi selisih luas (m²) agar ruang bernama sama digabung satu nomor. */
export const SECTION_LEGEND_AREA_TOL = 2;

/**
 * Kelompokkan irisan ruang per NAMA, lalu pecah lagi bila selisih luas > 2 m².
 * Level harus sudah urut dari terendah; nomor mengikuti urutan kemunculan.
 * Luas tiap kelompok = rata-rata luas (bukan akumulasi).
 */
export function groupSectionLegendRooms(levels: SectionLegendLevel[]) {
  const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const byName = new Map<string, SectionLegendRoom[]>();
  const rooms: SectionLegendRoom[] = [];
  for (const level of levels) {
    for (const sl of level.slices) {
      const nk = nameKey(sl.name);
      const buckets = byName.get(nk) ?? [];
      let bucket = buckets.find((bk) => Math.abs(bk.areaM2 - sl.areaM2) <= SECTION_LEGEND_AREA_TOL);
      if (!bucket) {
        bucket = { key: `${nk}#${buckets.length + 1}`, number: rooms.length + 1, name: sl.name, color: sl.color, areas: [], areaM2: 0, levelName: level.name, layerIds: [] };
        buckets.push(bucket);
        byName.set(nk, buckets);
        rooms.push(bucket);
      }
      bucket.areas.push(sl.areaM2);
      bucket.areaM2 = bucket.areas.reduce((a, x) => a + x, 0) / bucket.areas.length;
      bucket.layerIds.push(sl.layerId);
    }
  }
  const numberByLayerId = new Map<string, number>();
  for (const r of rooms) for (const id of r.layerIds) numberByLayerId.set(id, r.number);
  return { rooms, numberByLayerId };
}

/** Ukuran daftar legenda ruang (sama dengan slide Potongan Prinsip Skematik). */
export function sectionLegendMetrics(count: number) {
  const n = count;
  const cols = n > 60 ? 4 : n > 36 ? 3 : n > 16 ? 2 : 1;
  const width = cols === 4 ? 460 : cols === 3 ? 380 : cols === 2 ? 320 : 240;
  const fontSize = n > 80 ? 8 : n > 60 ? 9 : n > 40 ? 10 : n > 24 ? 11 : 12;
  const marginBottom = n > 60 ? 2 : n > 30 ? 3 : 4;
  return { cols, width, fontSize, marginBottom };
}
