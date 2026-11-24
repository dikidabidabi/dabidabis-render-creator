import type { Detail3dPrism } from "./level-detail-3d";
type P = { x: number; y: number };
type Ring = P[];

/** Tebal pelat tangga & bordes (tegak lurus kemiringan), sama dengan Potongan Prinsip. */
export const SECTION3D_STAIR_SLAB_M = 0.15;

export type Section3dStairSurface = { polygon: P[]; elevationRatio: number; kind: "tread" | "landing" };

/**
 * Tangga beton masif (meter, relatif muka lantai asal) dari bidang anak tangga
 * & bordes denah (px): tiap anak tangga = blok dari injakan ke pelat tangga
 * miring setebal 15 cm, sehingga satu ibu tangga berpenampang gerigi di atas
 * dan miring di bawah; bordes = pelat datar 15 cm. Arah naik tiap anak tangga
 * dicari dari sisi yang berimpit dengan anak tangga/bordes sebelum & sesudahnya.
 */
export function section3dStairs(surfaces: Section3dStairSurface[], heightM: number, pxPerMeter: number): Detail3dPrism[] {
  const ppm = pxPerMeter > 0 ? pxPerMeter : 1;
  if (!(heightM > 0)) return [];
  const items = surfaces
    .filter((sf) => sf.polygon.length >= 3)
    .map((sf) => ({ ...sf, ring: sf.polygon.map((p) => ({ x: p.x / ppm, y: p.y / ppm })), e: heightM * sf.elevationRatio }));
  const treads = items.filter((it) => it.kind === "tread");
  const riser = treads.length ? heightM / Math.max(1, Math.round(1 / Math.min(...treads.map((t) => t.elevationRatio)))) : heightM;
  const T = SECTION3D_STAIR_SLAB_M;
  const sharedMid = (a: Ring, b: Ring): P | null => {
    const hits = a.filter((p) => b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 2e-3));
    if (hits.length < 2) return null;
    return { x: hits.reduce((sum, p) => sum + p.x, 0) / hits.length, y: hits.reduce((sum, p) => sum + p.y, 0) / hits.length };
  };
  const centroid = (ring: Ring) => ({ x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length });
  const out: Detail3dPrism[] = [];
  for (const it of items) {
    if (it.kind === "landing") {
      out.push({ kind: "stair", outer: it.ring, holes: [], bottom: Math.max(0, it.e - T), top: it.e });
      continue;
    }
    let prev: P | null = null, next: P | null = null;
    for (const other of items) {
      if (other === it) continue;
      const isPrev = other.e < it.e - 1e-6;
      const isNext = other.e > it.e + 1e-6 || (other.kind === "landing" && Math.abs(other.e - it.e) < 1e-6);
      if (!isPrev && !isNext) continue;
      const m = sharedMid(it.ring, other.ring);
      if (!m) continue;
      if (isPrev && !prev) prev = m;
      if (isNext && !next) next = m;
    }
    const c = centroid(it.ring);
    const from = prev ?? c, to = next ?? c;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const r = Math.min(riser, it.e);
    if (!(len > 1e-6)) {
      out.push({ kind: "stair", outer: it.ring, holes: [], bottom: Math.max(0, it.e - r - T), top: it.e });
      continue;
    }
    const dir = { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
    const along = it.ring.map((p) => (p.x - c.x) * dir.x + (p.y - c.y) * dir.y);
    const a0 = Math.min(...along), going = Math.max(1e-3, Math.max(...along) - a0);
    const grad = r / going;
    // Garis kemiringan melewati pangkal tanjakan (a0, e − r); pelat setebal T tegak lurus kemiringan.
    const h0 = it.e - r - grad * a0 - T * Math.hypot(1, grad);
    out.push({ kind: "stair", outer: it.ring, holes: [], bottom: 0, top: it.e, soffit: { origin: c, dir, h0, grad, min: 0 } });
  }
  return out;
}

