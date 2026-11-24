// Geometri "Potongan 3D": model Detail 3D semua lantai disusun pada elevasi
// sebenarnya, dibelah oleh garis potong sketsa. Bagian di depan arah pandang
// dibuang; sisi yang terbelah menjadi bidang potong (poché) bergaya detail
// arsitektural. Balok mengikuti aturan Potongan Prinsip: plat + balok 40×70 cm
// di setiap as grid dan balok tepi 20 cm di keliling plat.
// Semua satuan METER pada bidang denah (x, y sketsa) kecuali disebut px.

import polygonClipping from "polygon-clipping";
import { detail3dBottomAt, type Detail3dKind, type Detail3dPrism } from "@/lib/level-detail-3d";
import { axisPositions, gridLocalToWorld, type StructuralGrid } from "@/lib/structural-grid";

type P = { x: number; y: number };
type Ring = P[];

export const SECTION3D_BEAM_WIDTH_M = 0.4;
export const SECTION3D_PERIMETER_BEAM_WIDTH_M = 0.2;
export const SECTION3D_BEAM_HEIGHT_M = 0.7;
/** Plafon khusus Potongan 3D: papan plafon dasar 2,8 m dari muka lantai, tebal 5 mm. */
export const SECTION3D_CEILING_HEIGHT_M = 2.8;
export const SECTION3D_CEILING_THICKNESS_M = 0.005;
/** Rangka hollow aluminium di atas papan: 2×4 cm (tinggi 2, lebar 4) @40 cm,
 *  di atasnya 4×4 cm @120 cm berlawanan arah. */
export const SECTION3D_CEILING_FURRING = { height: 0.02, width: 0.04, spacing: 0.4 };
export const SECTION3D_CEILING_RUNNER = { height: 0.04, width: 0.04, spacing: 1.2 };
const NO_CEILING_ROOM = /lift|shaft|tangga/i;
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

/** b0/b1 = dasar di s0/s1 bila dasarnya miring (pelat tangga). */
export type Section3dCutFace = { kind: Detail3dKind; s0: number; s1: number; bottom: number; top: number; b0?: number; b1?: number };

/** Sisi prisma yang tepat berada di bidang potong (sudah dibelah). */
export function sectionCutFaces(prisms: Detail3dPrism[], frame: Section3dFrame, tol = 1e-4): Section3dCutFace[] {
  const out: Section3dCutFace[] = [];
  for (const prism of prisms) {
    for (const ring of [prism.outer, ...prism.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = sectionCoords(frame, ring[i]!), q = sectionCoords(frame, ring[(i + 1) % ring.length]!);
        if (Math.abs(p.d) > tol || Math.abs(q.d) > tol) continue;
        const s0 = Math.min(p.s, q.s), s1 = Math.max(p.s, q.s);
        if (!(s1 - s0 > 1e-4)) continue;
        if (!prism.soffit) { out.push({ kind: prism.kind, s0, s1, bottom: prism.bottom, top: prism.top }); continue; }
        const [first, second] = p.s <= q.s ? [ring[i]!, ring[(i + 1) % ring.length]!] : [ring[(i + 1) % ring.length]!, ring[i]!];
        const b0 = detail3dBottomAt(prism, first), b1 = detail3dBottomAt(prism, second);
        out.push({ kind: prism.kind, s0, s1, bottom: Math.min(b0, b1), top: prism.top, b0, b1 });
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

/** Posisi as rangka berjarak tetap, terpusat pada rentang [min, max]. */
export function ceilingFramePositions(min: number, max: number, spacing: number): number[] {
  const span = max - min;
  if (!(span > 0) || !(spacing > 0)) return [];
  const n = Math.max(1, Math.floor(span / spacing + 1e-9));
  const start = min + (span - (n - 1) * spacing) / 2;
  return Array.from({ length: n }, (_, i) => start + i * spacing);
}

/**
 * Plafon (meter, relatif muka lantai) pada ruang yang tertutup plat lantai di
 * atasnya: hanya bagian ruang yang berada di bawah plat atas (lubang/void plat
 * tidak diberi plafon). Ruang lift, shaft, dan tangga tidak diberi plafon.
 * Papan plafon 5 mm; di atasnya rangka hollow 2×4 cm @40 cm sejajar sisi
 * terpanjang ruang, lalu hollow 4×4 cm @120 cm tegak lurus terhadapnya.
 * Bila tinggi lantai kurang, seluruh susunan diturunkan agar tetap di bawah plat atas.
 */
export function section3dCeilings(
  rooms: Array<{ name: string; points: P[] }>,
  slabsAbove: Array<{ outer: P[]; holes?: P[][]; thicknessMm: number }>,
  pxPerMeter: number,
  floorHeight: number,
): Detail3dPrism[] {
  const ppm = pxPerMeter > 0 ? pxPerMeter : 1;
  const toM = (ring: P[]) => ring.map((p) => ({ x: p.x / ppm, y: p.y / ppm }));
  const above = slabsAbove.filter((slab) => slab.outer.length >= 3);
  if (!above.length) return [];
  const thickAbove = Math.max(...above.map((slab) => Math.max(0.01, (Number(slab.thicknessMm) || 150) / 1000)));
  const stack = SECTION3D_CEILING_THICKNESS_M + SECTION3D_CEILING_FURRING.height + SECTION3D_CEILING_RUNNER.height;
  const bottom = Math.min(SECTION3D_CEILING_HEIGHT_M, floorHeight - thickAbove - stack);
  if (!(bottom > 0.5)) return [];
  const boardTop = bottom + SECTION3D_CEILING_THICKNESS_M;
  const furringTop = boardTop + SECTION3D_CEILING_FURRING.height;
  const runnerTop = furringTop + SECTION3D_CEILING_RUNNER.height;
  const slabGeoms = above.map((slab) => [ringToGeom(toM(slab.outer)), ...(slab.holes ?? []).filter((h) => h.length >= 3).map((h) => ringToGeom(toM(h)))]);
  const cover = safe(() => polygonClipping.union(slabGeoms[0] as any, ...(slabGeoms.slice(1) as any[])) as Geom);
  if (!cover || !cover.length) return [];
  const out: Detail3dPrism[] = [];
  const pushGeom = (geom: Geom | null, kind: Detail3dKind, b: number, t: number) => {
    for (const polygon of geom ?? []) {
      const [outer, ...holes] = polygon.map(openRing);
      if (!outer || outer.length < 3) continue;
      out.push({ kind, outer, holes: holes.filter((h) => h.length >= 3), bottom: b, top: t });
    }
  };
  for (const room of rooms) {
    const name = room.name.trim().toLowerCase();
    if (room.points.length < 3 || name.startsWith("lahan") || name === "void" || NO_CEILING_ROOM.test(name)) continue;
    const roomM = toM(room.points);
    const covered = safe(() => polygonClipping.intersection([ringToGeom(roomM)] as any, cover as any) as Geom);
    if (!covered || !covered.length) continue;
    pushGeom(covered, "ceiling", bottom, boardTop);
    // Arah rangka 2×4 = sisi terpanjang ruang; 4×4 tegak lurus.
    let e = { x: 1, y: 0 }, best = 0;
    roomM.forEach((p, i) => {
      const q = roomM[(i + 1) % roomM.length]!;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len > best + 1e-9) { best = len; e = { x: (q.x - p.x) / len, y: (q.y - p.y) / len }; }
    });
    const f = { x: -e.y, y: e.x };
    let minE = Infinity, maxE = -Infinity, minF = Infinity, maxF = -Infinity;
    for (const polygon of covered) for (const [x, y] of polygon[0] ?? []) {
      const pe = x * e.x + y * e.y, pf = x * f.x + y * f.y;
      minE = Math.min(minE, pe); maxE = Math.max(maxE, pe); minF = Math.min(minF, pf); maxF = Math.max(maxF, pf);
    }
    if (!Number.isFinite(minE)) continue;
    const at = (pe: number, pf: number) => ({ x: e.x * pe + f.x * pf, y: e.y * pe + f.y * pf });
    const members = (positions: number[], along: "e" | "f", width: number, kindBottom: number, kindTop: number) => {
      for (const t of positions) {
        const a = along === "e" ? at(minE - 1, t) : at(t, minF - 1);
        const b = along === "e" ? at(maxE + 1, t) : at(t, maxF + 1);
        const strip = [ringToGeom(rectAlong(a, b, width / 2))];
        pushGeom(safe(() => polygonClipping.intersection(strip as any, covered as any) as Geom), "ceilingFrame", kindBottom, kindTop);
      }
    };
    members(ceilingFramePositions(minF, maxF, SECTION3D_CEILING_FURRING.spacing), "e", SECTION3D_CEILING_FURRING.width, boardTop, furringTop);
    members(ceilingFramePositions(minE, maxE, SECTION3D_CEILING_RUNNER.spacing), "f", SECTION3D_CEILING_RUNNER.width, furringTop, runnerTop);
  }
  return out;
}

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
export function mergeCutFaces(faces: Array<{ s0: number; s1: number; bottom: number; top: number; b0?: number; b1?: number }>): Array<Array<Array<{ s: number; h: number }>>> {
  if (!faces.length) return [];
  const rects = faces.map((f) => [[[r6(f.s0), r6(f.b0 ?? f.bottom)], [r6(f.s1), r6(f.b1 ?? f.bottom)], [r6(f.s1), r6(f.top)], [r6(f.s0), r6(f.top)]] as Array<[number, number]>]);
  const merged = safe(() => polygonClipping.union(rects[0] as any, ...(rects.slice(1) as any[])) as Geom) ?? rects;
  return merged
    .map((polygon) => polygon.map((ring) => openRing(ring).map((p) => ({ s: p.x, h: p.y }))).filter((ring) => ring.length >= 3))
    .filter((polygon) => polygon.length > 0);
}
