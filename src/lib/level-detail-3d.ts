// Geometri "Detail 3D" per level: lantai, dinding setebal material, pintu dan
// jendela, dibangun dari data sketsa yang sama dengan Slide Detail dan DXF.
// Semua hasil dalam METER pada bidang denah (x kanan, y = arah +y kanvas),
// tinggi relatif terhadap lantai level (0 = muka lantai).

import polygonClipping from "polygon-clipping";
import { foldingDoorSegments, type Door } from "@/lib/doors";
import { windowFramePolygons, windowPlanGeometry, type Window } from "@/lib/windows";
import { computeStraightSegments, edgeMaterialForSegment, type EdgeMaterial } from "@/lib/edge-segments";
import { curveWallBand, sampleCurveLine } from "@/lib/curve-wall";
import { WALL_THICK_MM, isWallBandMaterial, materialForEdgeSegment, wallBandPolygon, windowWallCandidates } from "@/lib/wall-materials";

type P = { x: number; y: number };
type Ring = P[];
type MultiPolygon = Ring[][];

export type Detail3dKind = "floor" | "slab" | "wall" | "concrete" | "concept" | "glass" | "railing" | "frame" | "door";

export type Detail3dPrism = {
  kind: Detail3dKind;
  outer: Ring;
  holes: Ring[];
  bottom: number;
  top: number;
  color?: string;
};

export type Detail3dLine = { a: P; b: P; kind?: "straight" | "arc" | "bezier"; bulge?: number; c1?: P; c2?: P; levelId?: string };

export type Detail3dInput = {
  pxPerMeter: number;
  levelId: string;
  /** Seluruh garis sketsa (semua level) agar identitas segmen material sama dengan slide. */
  lines: Detail3dLine[];
  edgeAttrs?: Record<string, EdgeMaterial>;
  rooms: Array<{ name: string; points: P[]; color: string }>;
  slabs?: Array<{ outer: P[]; holes?: P[][]; thicknessMm: number }>;
  doors: Array<Pick<Door, "a" | "b" | "nx" | "ny" | "leaves" | "type" | "slideDirection" | "foldingSideMode" | "foldingSide" | "foldingLeafCount" | "widthCm">>;
  windows: Window[];
  /** Tinggi dinding (m) = tinggi level. */
  wallHeight: number;
};

export type Detail3dModel = {
  prisms: Detail3dPrism[];
  wallHeight: number;
  doorHeight: number;
  sillHeight: number;
  headHeight: number;
  counts: { walls: number; doors: number; windows: number; rooms: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
};

export const DETAIL3D_DOOR_HEIGHT_M = 2.1;
export const DETAIL3D_WINDOW_SILL_M = 0.9;
export const DETAIL3D_WINDOW_HEAD_M = 2.1;
export const DETAIL3D_RAILING_HEIGHT_M = 1;
export const DETAIL3D_ROOM_SLAB_M = 0.15;
const DEFAULT_TOP_LEVEL_H = 4;
const TYPICAL_FLOOR_H = 3;

/**
 * Tinggi level (m) sama dengan Model 3D: selisih MDPL ke level di atasnya
 * (memperhitungkan tumpukan lantai tipikal), tinggi tipikal untuk level
 * tipikal, dan 4 m untuk level teratas.
 */
export function levelWallHeight(levels: Array<{ id: string; mdpl: number; typicalCount?: number; typicalHeight?: number }>, levelId: string): number {
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  let shift = 0;
  const adjusted = sorted.map((lv) => {
    const k = Math.max(1, Math.round(Number(lv.typicalCount) || 1));
    const rawH = Number(lv.typicalHeight);
    const h = Number.isFinite(rawH) && rawH > 0 ? rawH : TYPICAL_FLOOR_H;
    const base = (Number(lv.mdpl) || 0) + shift;
    shift += (k - 1) * h;
    return { id: lv.id, k, base, h };
  });
  const index = adjusted.findIndex((lv) => lv.id === levelId);
  if (index < 0) return DEFAULT_TOP_LEVEL_H;
  const current = adjusted[index]!;
  if (current.k > 1) return current.h;
  const next = adjusted[index + 1];
  return next ? Math.max(0.1, next.base - current.base) : DEFAULT_TOP_LEVEL_H;
}

/** Tinggi pintu & jendela yang muat di bawah dinding. */
export function openingHeights(wallHeight: number) {
  const h = Math.max(0.1, wallHeight);
  const doorHeight = Math.min(DETAIL3D_DOOR_HEIGHT_M, h * 0.85);
  const headHeight = Math.min(DETAIL3D_WINDOW_HEAD_M, doorHeight);
  const sillHeight = Math.min(DETAIL3D_WINDOW_SILL_M, headHeight * 0.45);
  return { doorHeight, headHeight, sillHeight };
}

// ---------- Bantu poligon ----------
const round = (n: number) => Math.round(n * 1e4) / 1e4;
type Geom = Array<Array<Array<[number, number]>>>;
const toGeom = (mp: MultiPolygon): Geom => mp.map((polygon) => polygon.map((ring) => ring.map((p) => [round(p.x), round(p.y)] as [number, number])));
const fromGeom = (mp: Geom): MultiPolygon => mp.map((polygon) => polygon.map((ring) => openRing(ring.map(([x, y]) => ({ x, y })))));

function openRing(ring: Ring): Ring {
  if (ring.length > 1) {
    const first = ring[0]!, last = ring[ring.length - 1]!;
    if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) return ring.slice(0, -1);
  }
  return ring;
}
function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
function validRing(ring: Ring): boolean {
  return ring.length >= 3 && ring.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) && Math.abs(ringArea(ring)) > 1e-8;
}
function union(rings: Ring[]): MultiPolygon {
  const valid = rings.filter(validRing);
  if (!valid.length) return [];
  try {
    const geoms = valid.map((ring) => toGeom([[ring]])[0]!);
    return fromGeom(polygonClipping.union(geoms[0] as any, ...(geoms.slice(1) as any[])) as Geom);
  } catch {
    return valid.map((ring) => [ring]);
  }
}
function difference(subject: MultiPolygon, cut: MultiPolygon): MultiPolygon {
  if (!subject.length || !cut.length) return subject;
  try { return fromGeom(polygonClipping.difference(toGeom(subject) as any, toGeom(cut) as any) as Geom); } catch { return subject; }
}
function intersection(subject: MultiPolygon, clip: MultiPolygon): MultiPolygon {
  if (!subject.length || !clip.length) return [];
  try { return fromGeom(polygonClipping.intersection(toGeom(subject) as any, toGeom(clip) as any) as Geom); } catch { return []; }
}
function rectAlong(a: P, b: P, half: number, extendStart = 0, extendEnd = extendStart): Ring {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  const nx = -uy, ny = ux;
  const s = { x: a.x - ux * extendStart, y: a.y - uy * extendStart };
  const e = { x: b.x + ux * extendEnd, y: b.y + uy * extendEnd };
  return [
    { x: s.x + nx * half, y: s.y + ny * half },
    { x: e.x + nx * half, y: e.y + ny * half },
    { x: e.x - nx * half, y: e.y - ny * half },
    { x: s.x - nx * half, y: s.y - ny * half },
  ];
}

type WallClass = "wall" | "concrete" | "concept" | "glass" | "railing";
function wallClassOf(material: EdgeMaterial): WallClass {
  if (material.startsWith("concrete")) return "concrete";
  if (isWallBandMaterial(material)) return "wall";
  if (material === "concept") return "concept";
  if (material === "railing") return "railing";
  return "glass"; // curtain & window
}

export function buildLevelDetail3d(input: Detail3dInput): Detail3dModel {
  const ppm = input.pxPerMeter > 0 ? input.pxPerMeter : 1;
  const levelId = input.levelId;
  const edgeAttrs = input.edgeAttrs ?? {};
  const allLines = input.lines ?? [];
  const levelLines = allLines.filter((line) => line.levelId === levelId);
  const wallHeight = Math.max(0.1, Number(input.wallHeight) || DEFAULT_TOP_LEVEL_H);
  const { doorHeight, headHeight, sillHeight } = openingHeights(wallHeight);
  const prims: Detail3dPrism[] = [];
  const push = (kind: Detail3dKind, shape: MultiPolygon, bottom: number, top: number, color?: string) => {
    if (!(top - bottom > 1e-4)) return;
    for (const polygon of shape) {
      const [outer, ...holes] = polygon;
      if (!outer || !validRing(outer)) continue;
      prims.push({ kind, outer, holes: holes.filter(validRing), bottom, top, ...(color ? { color } : {}) });
    }
  };

  // ---- Pita dinding per kelas material ----
  const bands: Record<WallClass, Ring[]> = { wall: [], concrete: [], concept: [], glass: [], railing: [] };
  let wallCount = 0;
  const segs = computeStraightSegments(allLines.map((l) => ({ a: l.a, b: l.b, kind: l.kind, levelId: l.levelId }))).filter((segment) => {
    const source = allLines[segment.sourceLineIndex];
    return !!source && (source.kind ?? "straight") === "straight" && segment.levelId === levelId;
  });
  for (const segment of segs) {
    const material = materialForEdgeSegment(segment, allLines, edgeAttrs);
    if (!material) continue;
    const half = WALL_THICK_MM[material] / 2000 * ppm;
    bands[wallClassOf(material)].push(wallBandPolygon(segment, half, half));
    wallCount++;
  }
  for (const line of levelLines) {
    if ((line.kind ?? "straight") === "straight") continue;
    const material = edgeMaterialForSegment(edgeAttrs, line);
    if (!material) continue;
    const half = WALL_THICK_MM[material] / 2000 * ppm;
    const ring = curveWallBand(sampleCurveLine(line), half, half);
    if (ring.length >= 3) { bands[wallClassOf(material)].push(ring); wallCount++; }
  }

  // ---- Bukaan ----
  const wallCandidates = windowWallCandidates(levelLines, edgeAttrs);
  const depthAt = (a: P, b: P) => {
    const geometry = windowPlanGeometry({ a, b }, ppm, wallCandidates);
    return geometry ? geometry.halfDepth * 2 : 0.15 * ppm;
  };
  const doorCuts = union(input.doors.map((door) => rectAlong(door.a, door.b, depthAt(door.a, door.b) * 0.7)));
  const windowCuts = difference(union(input.windows.map((window) => rectAlong(window.a, window.b, depthAt(window.a, window.b) * 0.7))), doorCuts);
  const openingCuts = union([...doorCuts, ...windowCuts].flat());

  const shapes: Record<WallClass, MultiPolygon> = {
    concrete: union(bands.concrete),
    wall: [], concept: [], glass: [], railing: [],
  };
  shapes.wall = difference(union(bands.wall), shapes.concrete);
  const heavy = union([...shapes.concrete, ...shapes.wall].flat());
  shapes.concept = difference(union(bands.concept), heavy);
  const solid = union([...heavy, ...shapes.concept].flat());
  shapes.glass = difference(union(bands.glass), solid);
  shapes.railing = difference(union(bands.railing), union([...solid, ...shapes.glass].flat()));

  for (const cls of ["wall", "concrete", "concept", "glass"] as const) {
    const shape = shapes[cls];
    if (!shape.length) continue;
    push(cls, difference(shape, openingCuts), 0, wallHeight);
    push(cls, intersection(shape, doorCuts), doorHeight, wallHeight);
    const underWindow = intersection(shape, windowCuts);
    push(cls, underWindow, 0, sillHeight);
    push(cls, underWindow, headHeight, wallHeight);
  }
  push("railing", difference(shapes.railing, doorCuts), 0, DETAIL3D_RAILING_HEIGHT_M);

  // ---- Pintu: kusen + daun (mengikuti notasi denah) ----
  const jamb = 0.05 * ppm;
  const leafT = 0.04 * ppm;
  for (const door of input.doors) {
    const { a, b } = door;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 1e-6)) continue;
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
    const px = -dy, py = dx;
    const depth = depthAt(a, b);
    const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
    push("frame", [[rectAlong(a, at(Math.min(jamb, len / 2)), depth / 2)]], 0, doorHeight);
    push("frame", [[rectAlong(at(Math.max(len - jamb, len / 2)), b, depth / 2)]], 0, doorHeight);
    push("frame", [[rectAlong(a, b, depth / 2)]], doorHeight - 0.05, doorHeight);
    const leafTop = doorHeight - 0.05, leafBottom = 0.01;
    const widthPx = len;
    const leaves: Array<[P, P]> = [];
    if (door.type === "folding") {
      leaves.push(...foldingDoorSegments(door));
    } else if (door.type === "sliding") {
      const sideSign = door.nx * px + door.ny * py < 0 ? -1 : 1;
      const offset = depth / 2 + 0.06 * ppm;
      const ox = px * offset * sideSign, oy = py * offset * sideSign;
      if (door.leaves === 2) {
        const halfLeaf = widthPx / 2, shift = halfLeaf * 0.5;
        const m = at(len / 2);
        leaves.push([{ x: m.x - dx * (shift + halfLeaf) + ox, y: m.y - dy * (shift + halfLeaf) + oy }, { x: m.x - dx * shift + ox, y: m.y - dy * shift + oy }]);
        leaves.push([{ x: m.x + dx * shift + ox, y: m.y + dy * shift + oy }, { x: m.x + dx * (shift + halfLeaf) + ox, y: m.y + dy * (shift + halfLeaf) + oy }]);
      } else {
        const start = (door.slideDirection === "right" ? 1 : -1) * widthPx * 0.5;
        const s = { x: a.x + dx * start + ox, y: a.y + dy * start + oy };
        leaves.push([s, { x: s.x + dx * widthPx, y: s.y + dy * widthPx }]);
      }
    } else if (door.leaves === 2) {
      const half = widthPx / 2;
      leaves.push([a, { x: a.x + door.nx * half, y: a.y + door.ny * half }]);
      leaves.push([b, { x: b.x + door.nx * half, y: b.y + door.ny * half }]);
    } else {
      leaves.push([a, { x: a.x + door.nx * widthPx, y: a.y + door.ny * widthPx }]);
    }
    for (const [from, to] of leaves) push("door", [[rectAlong(from, to, leafT / 2)]], leafBottom, leafTop);
  }

  // ---- Jendela: kaca + kusen ----
  for (const window of input.windows) {
    const geometry = windowPlanGeometry(window, ppm, wallCandidates);
    if (!geometry) continue;
    push("glass", [[rectAlong(window.a, window.b, 0.006 * ppm)]], sillHeight, headHeight);
    for (const frame of windowFramePolygons(window, ppm, wallCandidates)) push("frame", [[frame]], sillHeight, headHeight);
    push("frame", [[geometry.footprint]], sillHeight, sillHeight + 0.05);
    push("frame", [[geometry.footprint]], headHeight - 0.05, headHeight);
  }

  // ---- Lantai ----
  let roomCount = 0;
  for (const room of input.rooms) {
    const name = room.name.trim().toLowerCase();
    if (name.startsWith("lahan") || name === "void" || room.points.length < 3) continue;
    push("floor", [[room.points]], -DETAIL3D_ROOM_SLAB_M, 0.005, room.color);
    roomCount++;
  }
  for (const slab of input.slabs ?? []) {
    if (slab.outer.length < 3) continue;
    const t = Math.max(0.01, (Number(slab.thicknessMm) || 150) / 1000);
    push("slab", [[slab.outer, ...(slab.holes ?? []).filter((h) => h.length >= 3)]], -t, 0);
  }

  // ---- px → meter ----
  const toM = (ring: Ring) => ring.map((p) => ({ x: p.x / ppm, y: p.y / ppm }));
  const prisms = prims.map((prism) => ({ ...prism, outer: toM(prism.outer), holes: prism.holes.map(toM) }));
  let bounds: Detail3dModel["bounds"] = null;
  for (const prism of prisms) {
    for (const p of prism.outer) {
      if (!bounds) bounds = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
      else {
        bounds.minX = Math.min(bounds.minX, p.x); bounds.minY = Math.min(bounds.minY, p.y);
        bounds.maxX = Math.max(bounds.maxX, p.x); bounds.maxY = Math.max(bounds.maxY, p.y);
      }
    }
  }
  return {
    prisms,
    wallHeight,
    doorHeight,
    sillHeight,
    headHeight,
    counts: { walls: wallCount, doors: input.doors.length, windows: input.windows.length, rooms: roomCount },
    bounds,
  };
}
