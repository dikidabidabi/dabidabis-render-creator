// Geometri "Potongan 3D": model Detail 3D semua lantai disusun pada elevasi
// sebenarnya, dibelah oleh garis potong sketsa. Bagian di depan arah pandang
// dibuang; sisi yang terbelah menjadi bidang potong (poché) bergaya detail
// arsitektural. Balok mengikuti aturan Potongan Prinsip: plat + balok 40×70 cm
// di setiap as grid dan balok tepi 20 cm di keliling plat.
// Semua satuan METER pada bidang denah (x, y sketsa) kecuali disebut px.

import polygonClipping from "polygon-clipping";
import type { Detail3dKind, Detail3dPrism } from "@/lib/level-detail-3d";
import { axisPositions, gridLocalToWorld, type StructuralGrid } from "@/lib/structural-grid";

type P = { x: number; y: number };
type Ring = P[];

export const SECTION3D_BEAM_WIDTH_M = 0.4;
export const SECTION3D_PERIMETER_BEAM_WIDTH_M = 0.2;
export const SECTION3D_BEAM_HEIGHT_M = 0.7;
const TYPICAL_FLOOR_H = 3;
const TOP_FLOOR_H = 4;
const FAR = 10000;

export type ArchitecturalStyleId = "tosca" | "brown" | "blue" | "bata" | "mono" | "lightorange" | "monobiru";

/** Warna 3D per style detail arsitektural (selaras dengan variabel CSS slide Denah/Detail). */
export const SECTION3D_PALETTE: Record<ArchitecturalStyleId, { floor: string; wall: string; structure: string; cut: string; edge: string; shadow: string }> = {
  tosca: { floor: "#c6d6d4", wall: "#f4f6f6", structure: "#dde3e4", cut: "#ffffff", edge: "#283b3a", shadow: "#344b49" },
  brown: { floor: "#b9b8ae", wall: "#f3f2ed", structure: "#d9d8d0", cut: "#ffffff", edge: "#3d3f36", shadow: "#3b3d33" },
  blue: { floor: "#8f9db0", wall: "#eef1f4", structure: "#d3dae2", cut: "#ffffff", edge: "#1c3346", shadow: "#1c3346" },
  bata: { floor: "#a57177", wall: "#e8d6b0", structure: "#d9c49a", cut: "#d4b577", edge: "#3f252b", shadow: "#3f252b" },
  mono: { floor: "#efefef", wall: "#fafafa", structure: "#e4e4e4", cut: "#4a4a4a", edge: "#4a4a4a", shadow: "#4a4a4a" },
  lightorange: { floor: "#efefef", wall: "#fafafa", structure: "#e4e4e4", cut: "#bd5b28", edge: "#4a4a4a", shadow: "#4a4a4a" },
  monobiru: { floor: "#e3f0f6", wall: "#fafcfd", structure: "#dfe8ed", cut: "#3f718c", edge: "#4a4a4a", shadow: "#3f718c" },
};

/** Style yang paling banyak dipilih kotak detail bermode Arsitektural; seri → yang muncul lebih dulu; tanpa detail → Tosca. */
export function majorityArchitecturalStyle(areas: Array<{ showArchitectural?: boolean; architecturalStyle?: string }>): ArchitecturalStyleId {
  const counts = new Map<ArchitecturalStyleId, number>();
  for (const area of areas) {
    if (area.showArchitectural !== true) continue;
    const style = (area.architecturalStyle && area.architecturalStyle in SECTION3D_PALETTE ? area.architecturalStyle : "tosca") as ArchitecturalStyleId;
    counts.set(style, (counts.get(style) ?? 0) + 1);
  }
  let best: ArchitecturalStyleId = "tosca", bestCount = 0;
  for (const [style, count] of counts) if (count > bestCount) { best = style; bestCount = count; }
  return best;
}

/** Bidang potong: a = ujung awal (m), u = arah garis, n = arah pandang (sisi yang dipertahankan). */
export type Section3dFrame = { a: P; u: P; n: P; length: number };

export function section3dFrame(p1: P, p2: P, pxPerMeter: number): Section3dFrame | null {
  const ppm = pxPerMeter > 0 ? pxPerMeter : 1;
  const a = { x: p1.x / ppm, y: p1.y / ppm };
  const dx = (p2.x - p1.x) / ppm, dy = (p2.y - p1.y) / ppm;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-6)) return null;
  const u = { x: dx / length, y: dy / length };
  // Sama dengan panah arah pandang di kanvas Sketsa: tegak lurus ke kanan dari awal→akhir.
  return { a, u, n: { x: -u.y, y: u.x }, length };
}

/** Koordinat bidang potong: s sepanjang garis dari ujung awal, d = jarak ke belakang bidang (searah pandang). */
export function sectionCoords(frame: Section3dFrame, p: P) {
  const rx = p.x - frame.a.x, ry = p.y - frame.a.y;
  return { s: rx * frame.u.x + ry * frame.u.y, d: rx * frame.n.x + ry * frame.n.y };
}

function keptHalfPlane(frame: Section3dFrame): Ring {
  const { a, u, n } = frame;
  const at = (s: number, d: number) => ({ x: a.x + u.x * s + n.x * d, y: a.y + u.y * s + n.y * d });
  return [at(-FAR, 0), at(FAR, 0), at(FAR, FAR), at(-FAR, FAR)];
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
type Geom = Array<Array<Array<[number, number]>>>;
const ringToGeom = (ring: Ring) => ring.map((p) => [r6(p.x), r6(p.y)] as [number, number]);
function openRing(ring: Array<[number, number]>): Ring {
  const out = ring.map(([x, y]) => ({ x, y }));
  if (out.length > 1) {
    const f = out[0]!, l = out[out.length - 1]!;
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) out.pop();
  }
  return out;
}
function safe(op: () => Geom): Geom | null {
  try { return op(); } catch { return null; }
}

/** Belah prisma: hanya bagian di belakang bidang potong (searah pandang) yang dipertahankan. */
export function clipPrismsToSection(prisms: Detail3dPrism[], frame: Section3dFrame): Detail3dPrism[] {
  const half = [ringToGeom(keptHalfPlane(frame))];
  const out: Detail3dPrism[] = [];
  for (const prism of prisms) {
    const ds = prism.outer.map((p) => sectionCoords(frame, p).d);
    if (ds.every((d) => d >= 0)) { out.push(prism); continue; }
    if (ds.every((d) => d <= 0)) continue;
    const result = safe(() => polygonClipping.intersection([ringToGeom(prism.outer), ...prism.holes.map(ringToGeom)] as any, half as any) as Geom);
    if (!result) continue;
    for (const polygon of result) {
      const [outer, ...holes] = polygon.map(openRing);
      if (!outer || outer.length < 3) continue;
      out.push({ ...prism, outer, holes: holes.filter((h) => h.length >= 3) });
    }
  }
  return out;
}

export type Section3dCutFace = { kind: Detail3dKind; s0: number; s1: number; bottom: number; top: number };

/** Sisi prisma yang tepat berada di bidang potong (sudah dibelah). */
export function sectionCutFaces(prisms: Detail3dPrism[], frame: Section3dFrame, tol = 1e-4): Section3dCutFace[] {
  const out: Section3dCutFace[] = [];
  for (const prism of prisms) {
    for (const ring of [prism.outer, ...prism.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = sectionCoords(frame, ring[i]!), q = sectionCoords(frame, ring[(i + 1) % ring.length]!);
        if (Math.abs(p.d) > tol || Math.abs(q.d) > tol) continue;
        const s0 = Math.min(p.s, q.s), s1 = Math.max(p.s, q.s);
        if (s1 - s0 > 1e-4) out.push({ kind: prism.kind, s0, s1, bottom: prism.bottom, top: prism.top });
      }
    }
  }
  return out;
}

function rectAlong(a: P, b: P, half: number): Ring {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len * half, ny = (b.x - a.x) / len * half;
  return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
}

/**
 * Balok di bawah plat lantai (meter, relatif muka lantai): balok 40 cm di setiap
 * as grid yang melintasi plat dan balok tepi 20 cm di dalam keliling plat,
 * tinggi 70 cm di bawah tebal plat — sama dengan Potongan Prinsip.
 */
export function section3dBeams(
  slabs: Array<{ outer: P[]; holes?: P[][]; thicknessMm: number }>,
  grids: StructuralGrid[],
  pxPerMeter: number,
): Detail3dPrism[] {
  const ppm = pxPerMeter > 0 ? pxPerMeter : 1;
  const toM = (ring: P[]) => ring.map((p) => ({ x: p.x / ppm, y: p.y / ppm }));
  const axisBands: Ring[] = [];
  for (const grid of grids) {
    const line = (ax: number, ay: number, bx: number, by: number) => {
      const a = gridLocalToWorld(grid, ax, ay, ppm), b = gridLocalToWorld(grid, bx, by, ppm);
      axisBands.push(rectAlong({ x: a.x / ppm, y: a.y / ppm }, { x: b.x / ppm, y: b.y / ppm }, SECTION3D_BEAM_WIDTH_M / 2));
    };
    for (const x of axisPositions(grid.spansX ?? [])) line(x, -FAR / 10, x, FAR / 10);
    if (!grid.lineOnly) for (const y of axisPositions(grid.spansY ?? [])) line(-FAR / 10, y, FAR / 10, y);
  }
  const out: Detail3dPrism[] = [];
  for (const slab of slabs) {
    if (slab.outer.length < 3) continue;
    const outer = toM(slab.outer);
    const holes = (slab.holes ?? []).filter((h) => h.length >= 3).map(toM);
    const t = Math.max(0.01, (Number(slab.thicknessMm) || 150) / 1000);
    const edgeBands = [outer, ...holes].flatMap((ring) => ring.map((p, i) => rectAlong(p, ring[(i + 1) % ring.length]!, SECTION3D_PERIMETER_BEAM_WIDTH_M)));
    const bands = [...edgeBands, ...axisBands].map((ring) => [ringToGeom(ring)]);
    if (!bands.length) continue;
    const merged = safe(() => polygonClipping.union(bands[0] as any, ...(bands.slice(1) as any[])) as Geom);
    if (!merged) continue;
    const beams = safe(() => polygonClipping.intersection([ringToGeom(outer), ...holes.map(ringToGeom)] as any, merged as any) as Geom);
    for (const polygon of beams ?? []) {
      const [ring, ...inner] = polygon.map(openRing);
      if (!ring || ring.length < 3) continue;
      out.push({ kind: "slab", outer: ring, holes: inner.filter((h) => h.length >= 3), bottom: -t - SECTION3D_BEAM_HEIGHT_M, top: -t });
    }
  }
  return out;
}

/** Lantai yang terlihat (salinan tipikal ikut), elevasi dasar sama dengan Potongan Prinsip. */
export function section3dFloors(levels: Array<{ id: string; name: string; mdpl: number; typicalCount?: number; typicalHeight?: number }>) {
  const sorted = [...levels].sort((a, b) => (Number(a.mdpl) || 0) - (Number(b.mdpl) || 0));
  let shift = 0;
  const adjusted = sorted.map((lv) => {
    const k = Math.max(1, Math.round(Number(lv.typicalCount) || 1));
    const rawH = Number(lv.typicalHeight);
    const h = Number.isFinite(rawH) && rawH > 0 ? rawH : TYPICAL_FLOOR_H;
    const base = (Number(lv.mdpl) || 0) + shift;
    shift += (k - 1) * h;
    return { lv, k, base, h };
  });
  const out: Array<{ key: string; levelId: string; name: string; base: number; height: number; copy: number; copies: number }> = [];
  adjusted.forEach(({ lv, k, base, h }, i) => {
    const next = adjusted[i + 1];
    for (let j = 0; j < k; j++) {
      const height = k > 1 ? h : next ? Math.max(0.1, next.base - base) : TOP_FLOOR_H;
      out.push({ key: k > 1 ? `${lv.id}__t${j}` : lv.id, levelId: lv.id, name: lv.name, base: base + j * h, height, copy: j, copies: k });
    }
  });
  return out;
}

/** Gabungkan bidang potong sejenis menjadi siluet (koordinat s, h; cincin pertama = luar) agar plat + balok tampil satu poché. */
export function mergeCutFaces(faces: Array<{ s0: number; s1: number; bottom: number; top: number }>): Array<Array<Array<{ s: number; h: number }>>> {
  if (!faces.length) return [];
  const rects = faces.map((f) => [[[r6(f.s0), r6(f.bottom)], [r6(f.s1), r6(f.bottom)], [r6(f.s1), r6(f.top)], [r6(f.s0), r6(f.top)]] as Array<[number, number]>]);
  const merged = safe(() => polygonClipping.union(rects[0] as any, ...(rects.slice(1) as any[])) as Geom) ?? rects;
  return merged
    .map((polygon) => polygon.map((ring) => openRing(ring).map((p) => ({ s: p.x, h: p.y }))).filter((ring) => ring.length >= 3))
    .filter((polygon) => polygon.length > 0);
}
