// DXF (R2000 / AC1015 ASCII) untuk denah sketsa, mengikuti notasi Slide Detail.
// Setiap bagian dikelompokkan sebagai block: DINDING (notasi arsir = HATCH),
// KOLOM, GRID (garis as + bubble), PINTU-nn, JENDELA-nn. Nama & luas ruang
// ditulis sebagai TEXT CAD di model space.
// Unit DXF = METER (skala 1:1). Sumbu Y di-flip dari kanvas (Y kanvas turun →
// Y CAD naik). Seluruh geometri dihitung di koordinat kanvas (px) memakai
// modul yang sama dengan slide, lalu dikonversi saat ditulis.

import polygonClipping from "polygon-clipping";
import type { ParkingArea, ParkingStall } from "@/lib/parking";
import { foldingDoorSegments, type Door } from "@/lib/doors";
import { windowDividerFractions, windowPlanGeometry, type Window } from "@/lib/windows";
import { computeStraightSegments, edgeMaterialForSegment, type EdgeMaterial, type EdgeSegment } from "@/lib/edge-segments";
import { curveWallBand, sampleCurveLine } from "@/lib/curve-wall";
import { WALL_THICK_MM, isWallBandMaterial, materialForEdgeSegment, wallBandPolygon, windowWallCandidates } from "@/lib/wall-materials";
import { practicalColumnNodes } from "@/lib/practical-columns";
import {
  axisPositions,
  columnFootprintPolygon,
  extraLinePath,
  gridColumnPoints,
  gridLocalToWorld,
  isCircularColumn,
  levelInRange,
  spansForLevel,
  xAxisLabelAt,
  yAxisLabelAt,
  type StructuralGrid,
} from "@/lib/structural-grid";

export type DxfPoint = { x: number; y: number };

export type DxfLine = {
  a: DxfPoint;
  b: DxfPoint;
  kind?: "straight" | "arc" | "bezier";
  bulge?: number;
  c1?: DxfPoint;
  c2?: DxfPoint;
  levelId?: string;
};

export type DxfLayerPoly = { name: string; points: DxfPoint[]; areaM2?: number };

export type DxfDoor = Pick<Door, "a" | "b" | "nx" | "ny" | "leaves" | "type" | "slideDirection" | "foldingSideMode" | "foldingSide" | "foldingLeafCount" | "widthCm">;

export type DxfExportInput = {
  pxPerMeter: number;
  /** Level yang diekspor; garis level lain hanya dipakai untuk identitas segmen. */
  levelId?: string | null;
  /** Seluruh garis sketsa (semua level), sama seperti sumber segmentasi slide. */
  lines: DxfLine[];
  edgeAttrs?: Record<string, EdgeMaterial>;
  layers: DxfLayerPoly[];
  doors: DxfDoor[];
  windows?: Window[];
  /** Grid aktif (collectGrids); difilter rentang levelnya di sini. */
  grids?: StructuralGrid[];
  levels?: Array<{ id: string; mdpl: number }>;
  parkingStallsByArea: Array<{ stalls: ParkingStall[] }>;
  parkingAreas: ParkingArea[];
  /** Rotasi mm-grid (radian) — perlu untuk konversi local→world path. */
  mmGridRotRad: number;
};

// Tebal finishing, kusen, dan daun pintu sama dengan Slide Detail.
export const DXF_FINISH_MM = 15;
export const DXF_JAMB_MM = 50;
export const DXF_DOOR_LEAF_MM = 40;
export const DXF_PRACTICAL_COLUMN_MM = 150;
// Notasi grid (meter).
const GRID_EXTENSION_M = 1.5;
const GRID_BUBBLE_RADIUS_M = 0.45;
const GRID_TEXT_HEIGHT_M = 0.4;

type P = DxfPoint;
type Ring = P[];
type MultiPolygon = Ring[][];

// ---------- Primitive (koordinat kanvas px) ----------

/** Notasi arsir: SOLID = isian penuh, WALL = pasangan garis 45° dinding bata, CONCRETE = bintik beton. */
export type DxfHatchKind = "SOLID" | "WALL" | "CONCRETE";

export type DxfPrim = Prim;
type Prim = (
  | { t: "poly"; layer: string; pts: P[]; closed: boolean; ltype?: string }
  | { t: "line"; layer: string; a: P; b: P; ltype?: string }
  | { t: "arc"; layer: string; c: P; r: number; from: P; to: P }
  | { t: "circle"; layer: string; c: P; r: number }
  | { t: "hatch"; layer: string; rings: P[][]; pattern: DxfHatchKind }
  | { t: "text"; layer: string; p: P; h: number; text: string }
) & {
  /** Nama block tempat primitive ini; kosong = langsung di model space. */
  block?: string;
  /** Titik dasar block (px kanvas). */
  base?: P;
};

export const DXF_BLOCK_WALLS = "DINDING";
export const DXF_BLOCK_COLUMNS = "KOLOM";
const ROOM_NAME_HEIGHT_M = 0.3;
const ROOM_AREA_HEIGHT_M = 0.22;

export const DXF_LAYERS: Array<{ name: string; color: number; ltype?: string }> = [
  { name: "0", color: 7 },
  { name: "SKETCH-LINE", color: 8 },
  { name: "WALL-SOLID", color: 7 },
  { name: "WALL-SOLID-CORE", color: 8 },
  { name: "WALL-SOLID-HATCH", color: 9 },
  { name: "WALL-CONCRETE-HATCH", color: 9 },
  { name: "WALL-CONCRETE", color: 7 },
  { name: "WALL-CONCRETE-CORE", color: 8 },
  { name: "WALL-CONCEPT", color: 7 },
  { name: "WALL-CURTAIN", color: 4 },
  { name: "WALL-WINDOW", color: 4 },
  { name: "RAILING", color: 30 },
  { name: "COLUMN", color: 7 },
  { name: "COLUMN-PRACTICAL", color: 7 },
  { name: "DOOR", color: 2 },
  { name: "WINDOW", color: 4 },
  { name: "GRID", color: 1, ltype: "GRIDCENTER" },
  { name: "GRID-BUBBLE", color: 1 },
  { name: "ROOM", color: 3 },
  { name: "ROOM-TEXT", color: 7 },
  { name: "PARKING-LOT", color: 5 },
  { name: "PARKING-AREA", color: 8 },
  { name: "PARKING-PATH", color: 1 },
  { name: "SECTION-CUT", color: 7 },
  { name: "SECTION-CUT-HATCH", color: 9 },
  { name: "SECTION-BEYOND", color: 8 },
  { name: "SECTION-OPENING", color: 4 },
  { name: "SECTION-LEVEL", color: 1, ltype: "GRIDCENTER" },
  { name: "SECTION-TEXT", color: 7 },
];

// ---------- Geometri bantu ----------

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const toGeom = (ring: Ring) => [ring.map((p) => [round(p.x), round(p.y)] as [number, number])];
const fromGeom = (mp: Array<Array<Array<[number, number]>>>): MultiPolygon =>
  mp.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => ({ x, y }))));

function validRing(ring: Ring): boolean {
  if (ring.length < 3 || ring.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) > 1e-8;
}

function unionRings(rings: Ring[]): MultiPolygon {
  const valid = rings.filter(validRing);
  if (!valid.length) return [];
  try {
    const geoms = valid.map(toGeom);
    return fromGeom(polygonClipping.union(geoms[0] as any, ...(geoms.slice(1) as any[])) as any);
  } catch {
    return valid.map((ring) => [ring]);
  }
}

function subtract(subject: MultiPolygon, cuts: MultiPolygon): MultiPolygon {
  if (!subject.length || !cuts.length) return subject;
  try {
    const subj = subject.map((polygon) => polygon.map((ring) => ring.map((p) => [round(p.x), round(p.y)] as [number, number])));
    const clip = cuts.map((polygon) => polygon.map((ring) => ring.map((p) => [round(p.x), round(p.y)] as [number, number])));
    return fromGeom(polygonClipping.difference(subj as any, ...(clip as any[])) as any);
  } catch {
    return subject;
  }
}

/** Ring polygon-clipping menutup diri dengan titik awal di akhir; buang duplikat itu. */
function openRing(ring: Ring): Ring {
  if (ring.length > 1) {
    const first = ring[0], last = ring[ring.length - 1];
    if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) return ring.slice(0, -1);
  }
  return ring;
}

/**
 * Garis arsir paralel di dalam multipolygon (dengan lubang), fase dikunci ke
 * titik (0,0) kanvas seperti pattern SVG userSpaceOnUse pada slide.
 * `angleDeg` = rotasi pattern SVG; garis pattern vertikal sebelum dirotasi.
 */
export function hatchSegments(shape: MultiPolygon, angleDeg: number, period: number, offsets: number[]): Array<[P, P]> {
  if (!(period > 0) || !shape.length) return [];
  const r = angleDeg * Math.PI / 180;
  const across = { x: Math.cos(r), y: Math.sin(r) }; // jarak antar garis
  const along = { x: -Math.sin(r), y: Math.cos(r) }; // arah garis
  const rings = shape.flatMap((polygon) => polygon.map(openRing));
  const us = rings.flatMap((ring) => ring.map((p) => p.x * across.x + p.y * across.y));
  if (!us.length) return [];
  const minU = Math.min(...us), maxU = Math.max(...us);
  const out: Array<[P, P]> = [];
  for (let k = Math.floor(minU / period) - 1; k <= Math.ceil(maxU / period); k++) {
    for (const offset of offsets) {
      const u = k * period + offset;
      if (u <= minU || u >= maxU) continue;
      const vs: number[] = [];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const ua = a.x * across.x + a.y * across.y, ub = b.x * across.x + b.y * across.y;
          if ((ua <= u && ub > u) || (ub <= u && ua > u)) {
            const t = (u - ua) / (ub - ua);
            const va = a.x * along.x + a.y * along.y, vb = b.x * along.x + b.y * along.y;
            vs.push(va + (vb - va) * t);
          }
        }
      }
      vs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < vs.length; i += 2) {
        if (vs[i + 1] - vs[i] < 1e-9) continue;
        const point = (v: number) => ({ x: across.x * u + along.x * v, y: across.y * u + along.y * v });
        out.push([point(vs[i]), point(vs[i + 1])]);
      }
    }
  }
  return out;
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

/** Poligon daun pintu setebal `thickness` dari p1 ke p2. */
function leafRing(p1: P, p2: P, thickness: number): Ring {
  return rectAlong(p1, p2, thickness / 2, 0, 0);
}

// ---------- Penyusun geometri denah ----------


export function buildPlanPrimitives(input: DxfExportInput): Prim[] {
  const ppm = input.pxPerMeter;
  const levelId = input.levelId ?? undefined;
  const edgeAttrs = input.edgeAttrs ?? {};
  const allLines = input.lines;
  const levelLines = allLines.filter((line) => !levelId || line.levelId === levelId);
  const prims: Prim[] = [];
  const finish = DXF_FINISH_MM / 1000 * ppm;

  // ---- Dinding ----
  const segs = computeStraightSegments(allLines.map((l) => ({ a: l.a, b: l.b, kind: l.kind, levelId: l.levelId }))).filter((segment) => {
    const source = allLines[segment.sourceLineIndex];
    if (!source || (source.kind ?? "straight") !== "straight") return false;
    return !levelId || segment.levelId === levelId;
  });
  type Band = { outer: Ring; core: Ring };
  const solidBands: Band[] = [];
  const concreteBands: Band[] = [];
  const otherSegments: Array<{ a: P; b: P; material: EdgeMaterial }> = [];
  const bandHalf = (material: EdgeMaterial) => WALL_THICK_MM[material] / 2000 * ppm;
  for (const segment of segs) {
    const material = materialForEdgeSegment(segment, allLines, edgeAttrs);
    if (!material) {
      prims.push({ t: "line", layer: "SKETCH-LINE", a: segment.a, b: segment.b });
      continue;
    }
    if (isWallBandMaterial(material)) {
      const half = bandHalf(material);
      const band = { outer: wallBandPolygon(segment, half, half), core: wallBandPolygon(segment, Math.max(0, half - finish), half) };
      (material.startsWith("concrete") ? concreteBands : solidBands).push(band);
    } else {
      otherSegments.push({ a: segment.a, b: segment.b, material });
    }
  }
  for (const line of levelLines) {
    if ((line.kind ?? "straight") === "straight") continue;
    const points = sampleCurveLine(line);
    const material = edgeMaterialForSegment(edgeAttrs, line);
    if (!material) {
      prims.push({ t: "poly", layer: "SKETCH-LINE", pts: points, closed: false });
      continue;
    }
    if (isWallBandMaterial(material)) {
      const half = bandHalf(material);
      const outer = curveWallBand(points, half, half);
      const core = curveWallBand(points, Math.max(0, half - finish), half);
      if (outer.length >= 3 && core.length >= 3) (material.startsWith("concrete") ? concreteBands : solidBands).push({ outer, core });
    } else {
      points.slice(1).forEach((point, index) => otherSegments.push({ a: points[index], b: point, material }));
    }
  }

  // Segmen bantu untuk tebal dinding di pintu/jendela.
  const levelSegments: Array<EdgeSegment & { material: EdgeMaterial }> = segs.flatMap((segment) => {
    const material = materialForEdgeSegment(segment, allLines, edgeAttrs);
    return material ? [{ ...segment, material }] : [];
  });
  const attachedDepth = (a: P, b: P) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let best: { material: EdgeMaterial; distance: number } | undefined;
    for (const segment of levelSegments) {
      const sx = segment.b.x - segment.a.x, sy = segment.b.y - segment.a.y;
      const segmentLength = Math.hypot(sx, sy);
      if (segmentLength < 1e-6) continue;
      if (Math.abs((sx / segmentLength) * dx + (sy / segmentLength) * dy) < 0.94) continue;
      const t = Math.max(0, Math.min(1, ((mid.x - segment.a.x) * sx + (mid.y - segment.a.y) * sy) / (segmentLength * segmentLength)));
      const distance = Math.hypot(mid.x - (segment.a.x + sx * t), mid.y - (segment.a.y + sy * t));
      if (!best || distance < best.distance) best = { material: segment.material, distance };
    }
    const mm = best && best.distance <= 0.35 * ppm ? WALL_THICK_MM[best.material] : 150;
    return mm / 1000 * ppm;
  };

  // ---- Bukaan & kolom (memotong dinding) ----
  const cuts: Ring[] = [];
  const jamb = DXF_JAMB_MM / 1000 * ppm;
  const doors = input.doors;
  for (const door of doors) {
    const depth = attachedDepth(door.a, door.b);
    cuts.push(rectAlong(door.a, door.b, depth * 0.7, jamb, jamb));
  }
  const windowWalls = windowWallCandidates(levelLines, edgeAttrs);
  const windows = input.windows ?? [];
  for (const window of windows) {
    const geometry = windowPlanGeometry(window, ppm, windowWalls);
    if (geometry) cuts.push(rectAlong(window.a, window.b, geometry.halfDepth * 1.4, 0, 0));
  }
  const levels = input.levels ?? [];
  const level = levelId ? levels.find((candidate) => candidate.id === levelId) : undefined;
  const grids = (input.grids ?? []).filter((grid) => !level || levelInRange(grid, level, levels));
  const columnRings: Array<{ ring: Ring; circle?: { c: P; r: number } }> = [];
  for (const grid of grids) {
    const { spansX, spansY } = spansForLevel(grid, levelId);
    const size = grid.colSizeCm / 100 * ppm;
    const angle = (Number(grid.rotation) || 0) * Math.PI / 180;
    for (const cp of gridColumnPoints(grid, levelId, spansX, spansY)) {
      const center = gridLocalToWorld(grid, cp.mx, cp.my, ppm);
      const ring = columnFootprintPolygon(center, size, angle, grid.colShape);
      columnRings.push({ ring, circle: isCircularColumn(grid) ? { c: center, r: size / 2 } : undefined });
      cuts.push(ring);
    }
  }
  const practical = practicalColumnNodes({ lines: levelLines, segmentationLines: allLines, levelId, edgeAttrs });
  const practicalSize = DXF_PRACTICAL_COLUMN_MM / 1000 * ppm;
  for (const node of practical) cuts.push(rectAlong({ x: node.point.x - practicalSize / 2, y: node.point.y }, { x: node.point.x + practicalSize / 2, y: node.point.y }, practicalSize / 2));
  const cutShape = unionRings(cuts);

  const concreteOuter = unionRings(concreteBands.map((band) => band.outer));
  const solidOuter = subtract(subtract(unionRings(solidBands.map((band) => band.outer)), concreteOuter), cutShape);
  const solidCore = subtract(subtract(unionRings(solidBands.map((band) => band.core)), concreteOuter), cutShape);
  const concreteOuterCut = subtract(concreteOuter, cutShape);
  const concreteCore = subtract(unionRings(concreteBands.map((band) => band.core)), cutShape);
  const pushShape = (shape: MultiPolygon, layer: string) => {
    for (const polygon of shape) for (const ring of polygon) {
      const pts = openRing(ring);
      if (pts.length >= 3) prims.push({ t: "poly", layer, pts, closed: true });
    }
  };
  pushShape(solidOuter, "WALL-SOLID");
  pushShape(solidCore, "WALL-SOLID-CORE");
  // Arsir dinding solid sebagai HATCH: pasangan garis 45°, jarak 40 mm, berulang tiap 150 mm.
  const pushHatch = (shape: MultiPolygon, layer: string, pattern: DxfHatchKind) => {
    const rings = shape.flatMap((polygon) => polygon.map(openRing)).filter((ring) => ring.length >= 3);
    if (rings.length) prims.push({ t: "hatch", layer, rings, pattern });
  };
  pushHatch(solidCore, "WALL-SOLID-HATCH", "WALL");
  pushShape(concreteOuterCut, "WALL-CONCRETE");
  pushShape(concreteCore, "WALL-CONCRETE-CORE");
  pushHatch(concreteCore, "WALL-CONCRETE-HATCH", "CONCRETE");

  // Material non-masif (konsep, curtain wall, jendela material, railing).
  for (const { a, b, material } of otherSegments) {
    const half = bandHalf(material);
    const ring = rectAlong(a, b, half, half, half);
    const [a1, b1, b2, a2] = ring;
    if (material === "concept") {
      prims.push({ t: "hatch", layer: "WALL-CONCEPT", rings: [ring], pattern: "SOLID" });
      prims.push({ t: "poly", layer: "WALL-CONCEPT", pts: ring, closed: true });
    } else if (material === "curtain") {
      prims.push({ t: "line", layer: "WALL-CURTAIN", a: a1, b: b1 });
      prims.push({ t: "line", layer: "WALL-CURTAIN", a: a2, b: b2 });
      const length = Math.hypot(b.x - a.x, b.y - a.y) + half * 2;
      const n = Math.max(1, Math.floor(length / (1.2 * ppm)));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        prims.push({ t: "line", layer: "WALL-CURTAIN", a: { x: a1.x + (b1.x - a1.x) * t, y: a1.y + (b1.y - a1.y) * t }, b: { x: a2.x + (b2.x - a2.x) * t, y: a2.y + (b2.y - a2.y) * t } });
      }
    } else if (material === "railing") {
      prims.push({ t: "line", layer: "RAILING", a: a1, b: b1 });
      prims.push({ t: "line", layer: "RAILING", a: a2, b: b2 });
    } else {
      prims.push({ t: "poly", layer: "WALL-WINDOW", pts: ring, closed: true });
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
      const sa = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 }, sb = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
      for (const offset of [-half * 0.33, 0, half * 0.33]) {
        prims.push({ t: "line", layer: "WALL-WINDOW", a: { x: sa.x + nx * offset, y: sa.y + ny * offset }, b: { x: sb.x + nx * offset, y: sb.y + ny * offset } });
      }
    }
  }

  tagBlock(prims, 0, DXF_BLOCK_WALLS);

  // ---- Kolom ----
  const columnStart = prims.length;
  for (const { ring, circle } of columnRings) {
    prims.push({ t: "hatch", layer: "COLUMN", rings: [ring], pattern: "SOLID" });
    if (circle) prims.push({ t: "circle", layer: "COLUMN", c: circle.c, r: circle.r });
    else prims.push({ t: "poly", layer: "COLUMN", pts: ring, closed: true });
  }
  for (const node of practical) {
    const h = practicalSize / 2;
    const square = (inset: number): Ring => [
      { x: node.point.x - h + inset, y: node.point.y - h + inset },
      { x: node.point.x + h - inset, y: node.point.y - h + inset },
      { x: node.point.x + h - inset, y: node.point.y + h - inset },
      { x: node.point.x - h + inset, y: node.point.y + h - inset },
    ];
    if (node.standard) {
      prims.push({ t: "poly", layer: "COLUMN-PRACTICAL", pts: square(0), closed: true });
      prims.push({ t: "poly", layer: "COLUMN-PRACTICAL", pts: square(finish), closed: true });
    } else {
      prims.push({ t: "hatch", layer: "COLUMN-PRACTICAL", rings: [square(0)], pattern: "SOLID" });
      prims.push({ t: "poly", layer: "COLUMN-PRACTICAL", pts: square(0), closed: true });
    }
  }

  tagBlock(prims, columnStart, DXF_BLOCK_COLUMNS);

  // ---- Pintu (kusen 50 mm, daun 40 mm): satu block per pintu ----
  const leafThickness = DXF_DOOR_LEAF_MM / 1000 * ppm;
  doors.forEach((door, index) => {
    const start = prims.length;
    prims.push(...doorPrimitives(door, ppm, attachedDepth(door.a, door.b), jamb, leafThickness));
    tagBlock(prims, start, dxfBlockName("PINTU", index), midpoint(door.a, door.b));
  });

  // ---- Jendela: satu block per jendela ----
  windows.forEach((window, index) => {
    const geometry = windowPlanGeometry(window, ppm, windowWalls);
    if (!geometry) return;
    const start = prims.length;
    const { dx, dy, nx, ny, halfDepth } = geometry;
    const jambRing = (c: P, direction: number): Ring => [
      { x: c.x + nx * halfDepth, y: c.y + ny * halfDepth },
      { x: c.x - nx * halfDepth, y: c.y - ny * halfDepth },
      { x: c.x - nx * halfDepth + dx * jamb * direction, y: c.y - ny * halfDepth + dy * jamb * direction },
      { x: c.x + nx * halfDepth + dx * jamb * direction, y: c.y + ny * halfDepth + dy * jamb * direction },
    ];
    prims.push({ t: "poly", layer: "WINDOW", pts: jambRing(window.a, 1), closed: true });
    prims.push({ t: "poly", layer: "WINDOW", pts: jambRing(window.b, -1), closed: true });
    const glassOffset = 0.005 * ppm;
    for (const side of [-1, 1]) {
      prims.push({
        t: "line", layer: "WINDOW",
        a: { x: window.a.x + dx * jamb + nx * glassOffset * side, y: window.a.y + dy * jamb + ny * glassOffset * side },
        b: { x: window.b.x - dx * jamb + nx * glassOffset * side, y: window.b.y - dy * jamb + ny * glassOffset * side },
      });
    }
    for (const t of windowDividerFractions(window, ppm)) {
      const c = { x: window.a.x + (window.b.x - window.a.x) * t, y: window.a.y + (window.b.y - window.a.y) * t };
      prims.push({ t: "poly", layer: "WINDOW", pts: rectAlong({ x: c.x - dx * jamb / 2, y: c.y - dy * jamb / 2 }, { x: c.x + dx * jamb / 2, y: c.y + dy * jamb / 2 }, halfDepth), closed: true });
    }
    tagBlock(prims, start, dxfBlockName("JENDELA", index), midpoint(window.a, window.b));
  });

  // ---- Grid struktur: garis as beserta bubble dalam satu block per grid ----
  grids.forEach((grid, index) => {
    const start = prims.length;
    prims.push(...gridPrimitives(grid, levelId, ppm));
    tagBlock(prims, start, grids.length === 1 ? "GRID" : dxfBlockName("GRID", index));
  });

  // ---- Ruang: batas ruang + nama dan luas sebagai TEXT CAD ----
  for (const layer of input.layers) {
    if (!layer.points || layer.points.length < 3) continue;
    prims.push({ t: "poly", layer: "ROOM", pts: layer.points, closed: true });
    const center = ringCentroid(layer.points);
    const nameH = ROOM_NAME_HEIGHT_M * ppm, areaH = ROOM_AREA_HEIGHT_M * ppm;
    const name = layer.name.trim();
    const area = Number.isFinite(layer.areaM2) ? Number(layer.areaM2) : Math.abs(ringArea(layer.points)) / (ppm * ppm);
    const gap = 0.08 * ppm;
    if (name) prims.push({ t: "text", layer: "ROOM-TEXT", p: { x: center.x, y: center.y - (areaH + gap) / 2 }, h: nameH, text: name });
    prims.push({ t: "text", layer: "ROOM-TEXT", p: { x: center.x, y: center.y + (name ? (nameH + gap) / 2 : 0) }, h: areaH, text: formatRoomArea(area) });
  }

  // ---- Parkir ----
  const cs = Math.cos(input.mmGridRotRad), sn = Math.sin(input.mmGridRotRad);
  const toWorld = (q: P) => ({ x: q.x * cs - q.y * sn, y: q.x * sn + q.y * cs });
  for (const area of input.parkingAreas) {
    if (!area.pointsLocal || area.pointsLocal.length < 3) continue;
    prims.push({ t: "poly", layer: "PARKING-AREA", pts: area.pointsLocal.map(toWorld), closed: true });
    for (const path of area.paths ?? []) prims.push({ t: "poly", layer: "PARKING-PATH", pts: path.pointsLocal.map(toWorld), closed: false });
  }
  for (const group of input.parkingStallsByArea) {
    for (const stall of group.stalls) {
      if (stall.valid) prims.push({ t: "poly", layer: "PARKING-LOT", pts: stall.poly, closed: true });
    }
  }
  return prims;
}

function tagBlock(prims: Prim[], start: number, block: string, base?: P) {
  for (let i = start; i < prims.length; i++) {
    prims[i].block = block;
    if (base) prims[i].base = base;
  }
}

const dxfBlockName = (prefix: string, index: number) => `${prefix}-${String(index + 1).padStart(2, "0")}`;
const midpoint = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function ringCentroid(ring: Ring): P {
  const area = ringArea(ring);
  if (Math.abs(area) < 1e-9) return { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length };
  let cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Luas ruang seperti slide: dua desimal format Indonesia, contoh "12,50 m²". */
export function formatRoomArea(areaM2: number): string {
  return `${(Number.isFinite(areaM2) ? areaM2 : 0).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

function doorPrimitives(d: DxfDoor, ppm: number, wallDepth: number, jambWidth: number, leafThickness: number): Prim[] {
  const out: Prim[] = [];
  const { a, b } = d;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
  const px = -dy, py = dx;
  const jh = wallDepth / 2;
  out.push({ t: "poly", layer: "DOOR", closed: true, pts: [
    { x: a.x + px * jh, y: a.y + py * jh }, { x: a.x - px * jh, y: a.y - py * jh },
    { x: a.x - px * jh - dx * jambWidth, y: a.y - py * jh - dy * jambWidth }, { x: a.x + px * jh - dx * jambWidth, y: a.y + py * jh - dy * jambWidth },
  ] });
  out.push({ t: "poly", layer: "DOOR", closed: true, pts: [
    { x: b.x + px * jh, y: b.y + py * jh }, { x: b.x - px * jh, y: b.y - py * jh },
    { x: b.x - px * jh + dx * jambWidth, y: b.y - py * jh + dy * jambWidth }, { x: b.x + px * jh + dx * jambWidth, y: b.y + py * jh + dy * jambWidth },
  ] });
  const threshold: Prim = { t: "line", layer: "DOOR", a, b, ltype: "DOORDASH" };
  const widthPx = d.widthCm / 100 * ppm;
  if (d.type === "folding") {
    for (const [from, to] of foldingDoorSegments(d)) out.push({ t: "poly", layer: "DOOR", pts: leafRing(from, to, leafThickness), closed: true });
    out.push(threshold);
    return out;
  }
  if (d.type === "sliding") {
    const sideSign = d.nx * px + d.ny * py < 0 ? -1 : 1;
    const leafCenterOffset = wallDepth / 2 + 0.04 * ppm + 0.02 * ppm;
    const ox = px * leafCenterOffset * sideSign, oy = py * leafCenterOffset * sideSign;
    const leaves: Array<[P, P]> = [];
    if (d.leaves === 2) {
      const halfLeaf = widthPx / 2, shift = halfLeaf * 0.5;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      leaves.push([{ x: mx - dx * (shift + halfLeaf) + ox, y: my - dy * (shift + halfLeaf) + oy }, { x: mx - dx * shift + ox, y: my - dy * shift + oy }]);
      leaves.push([{ x: mx + dx * shift + ox, y: my + dy * shift + oy }, { x: mx + dx * (shift + halfLeaf) + ox, y: my + dy * (shift + halfLeaf) + oy }]);
    } else {
      const startAlong = (d.slideDirection === "right" ? 1 : -1) * widthPx * 0.5;
      const s = { x: a.x + dx * startAlong + ox, y: a.y + dy * startAlong + oy };
      leaves.push([s, { x: s.x + dx * widthPx, y: s.y + dy * widthPx }]);
    }
    for (const [from, to] of leaves) out.push({ t: "poly", layer: "DOOR", pts: leafRing(from, to, 0.04 * ppm), closed: true });
    out.push(threshold);
    return out;
  }
  if (d.leaves === 2) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const half = widthPx / 2;
    const la = { x: a.x + d.nx * half, y: a.y + d.ny * half };
    const lb = { x: b.x + d.nx * half, y: b.y + d.ny * half };
    out.push({ t: "poly", layer: "DOOR", pts: leafRing(a, la, leafThickness), closed: true });
    out.push({ t: "poly", layer: "DOOR", pts: leafRing(b, lb, leafThickness), closed: true });
    out.push({ t: "arc", layer: "DOOR", c: a, r: half, from: la, to: mid });
    out.push({ t: "arc", layer: "DOOR", c: b, r: half, from: lb, to: mid });
    return out;
  }
  const leafTip = { x: a.x + d.nx * widthPx, y: a.y + d.ny * widthPx };
  out.push({ t: "poly", layer: "DOOR", pts: leafRing(a, leafTip, leafThickness), closed: true });
  out.push({ t: "arc", layer: "DOOR", c: a, r: widthPx, from: leafTip, to: b });
  out.push(threshold);
  return out;
}

function gridPrimitives(grid: StructuralGrid, levelId: string | undefined, ppm: number): Prim[] {
  const out: Prim[] = [];
  const ext = GRID_EXTENSION_M * ppm;
  const radius = GRID_BUBBLE_RADIUS_M * ppm;
  const textH = GRID_TEXT_HEIGHT_M * ppm;
  const bubble = (p: P, label: string) => {
    out.push({ t: "circle", layer: "GRID-BUBBLE", c: p, r: radius });
    out.push({ t: "text", layer: "GRID-BUBBLE", p, h: textH, text: label });
  };
  /** Garis as dari a ke b (px dunia), diperpanjang lalu diberi bubble di ujung. */
  const axis = (path: P[], startLabel: string | null, endLabel: string | null) => {
    if (path.length < 2) return;
    const unit = (from: P, to: P) => { const l = Math.hypot(to.x - from.x, to.y - from.y) || 1; return { x: (to.x - from.x) / l, y: (to.y - from.y) / l }; };
    const d0 = unit(path[0], path[1]);
    const dn = unit(path[path.length - 2], path[path.length - 1]);
    const start = { x: path[0].x - d0.x * ext, y: path[0].y - d0.y * ext };
    const end = { x: path[path.length - 1].x + dn.x * ext, y: path[path.length - 1].y + dn.y * ext };
    out.push({ t: "poly", layer: "GRID", pts: [start, ...path, end], closed: false });
    if (startLabel) bubble({ x: start.x - d0.x * radius, y: start.y - d0.y * radius }, startLabel);
    if (endLabel) bubble({ x: end.x + dn.x * radius, y: end.y + dn.y * radius }, endLabel);
  };
  const { spansX, spansY } = spansForLevel(grid, levelId);
  const xs = axisPositions(spansX), ys = axisPositions(spansY);
  const totX = xs[xs.length - 1] ?? 0, totY = ys[ys.length - 1] ?? 0;
  const world = (mx: number, my: number) => gridLocalToWorld(grid, mx, my, ppm);
  const offX = grid.labelOffsetX ?? 0, offY = grid.labelOffsetY ?? 0;
  if (grid.lineOnly) {
    const last = xs.length - 1;
    if (totX > 0) axis([world(0, 0), world(totX, 0)], grid.hideBubbleStartX ? null : xAxisLabelAt(0, offX), grid.hideBubbleEndX ? null : xAxisLabelAt(last, offX));
  } else {
    xs.forEach((x, i) => axis([world(x, 0), world(x, totY)], grid.hideBubbleStartY ? null : xAxisLabelAt(i, offX), grid.hideBubbleEndY ? null : xAxisLabelAt(i, offX)));
    ys.forEach((y, j) => axis([world(0, y), world(totX, y)], grid.hideBubbleStartX ? null : yAxisLabelAt(j, offY), grid.hideBubbleEndX ? null : yAxisLabelAt(j, offY)));
  }
  const baseIdx = offX + grid.spansX.length + 1;
  (grid.extraLines ?? []).forEach((line, index) => {
    const label = xAxisLabelAt(baseIdx + index, 0);
    axis(extraLinePath(line, ppm), line.hideStart ? null : label, line.hideEnd ? null : label);
  });
  return out;
}

// ---------- Penulis DXF (R2000 / AC1015) ----------

type Tag = [number, string | number];

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const fixed = n.toFixed(6).replace(/\.?0+$/, "");
  return fixed === "-0" || fixed === "" ? "0" : fixed;
}

/** Teks TEXT CAD satu baris; karakter di luar ANSI_1252 diubah saat file dikodekan (encodeDxf). */
export function dxfText(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ");
}

/**
 * Kodekan isi DXF sesuai $DWGCODEPAGE ANSI_1252 (R2000 tidak membaca UTF-8):
 * huruf Latin-1 seperti "²" ditulis satu byte, karakter lain sebagai \U+XXXX.
 */
// Karakter Windows-1252 di rentang 0x80–0x9F (tanda kutip, pisah, €, dll.).
const CP1252_EXTRA = new Map<number, number>([..."€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ"].map((ch, i) => [ch.codePointAt(0)!, 0x80 + i] as [number, number]).filter(([code]) => code > 0xff));

export function encodeDxf(content: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of content) {
    const code = ch.codePointAt(0) ?? 63;
    const extra = CP1252_EXTRA.get(code);
    if (extra !== undefined) bytes.push(extra);
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else for (const c of `\\U+${code.toString(16).toUpperCase().padStart(4, "0")}`) bytes.push(c.charCodeAt(0));
  }
  return Uint8Array.from(bytes);
}

const S45 = Math.SQRT1_2;
/** Definisi garis pola (sudah dirotasi, satuan meter) seperti yang disimpan entitas HATCH. */
const HATCH_PATTERNS: Record<Exclude<DxfHatchKind, "SOLID">, { name: string; lines: Array<{ angle: number; base: [number, number]; offset: [number, number]; dashes: number[] }> }> = {
  // Sama dengan pola slide: dua garis 45° berjarak 40 mm, berulang tiap 150 mm.
  WALL: {
    name: "DABI_DINDING",
    lines: [0.015, 0.055].map((o) => ({ angle: 45, base: [S45 * o, -S45 * o] as [number, number], offset: [-S45 * 0.15, S45 * 0.15] as [number, number], dashes: [] })),
  },
  // Bintik beton renggang.
  CONCRETE: {
    name: "DABI_BETON",
    lines: [{ angle: 0, base: [0, 0], offset: [0.05, 0.1], dashes: [0, -0.1] }],
  },
};

class DxfWriter {
  private seq = 0x30;
  handle(): string {
    return (this.seq++).toString(16).toUpperCase();
  }
  get seed(): string {
    return this.seq.toString(16).toUpperCase();
  }
}

function write(buf: string[], tags: Tag[]) {
  for (const [g, v] of tags) {
    buf.push(String(g));
    buf.push(typeof v === "number" ? formatNum(v) : v);
  }
}

type Ctx = { w: DxfWriter; owner: string; ppm: number; base: P };

function entityHead(ctx: Ctx, type: string, layer: string, subclass: string, ltype?: string): Tag[] {
  const tags: Tag[] = [[0, type], [5, ctx.w.handle()], [330, ctx.owner], [100, "AcDbEntity"], [8, layer]];
  if (ltype) tags.push([6, ltype]);
  tags.push([100, subclass]);
  return tags;
}

function emitPrim(buf: string[], prim: Prim, ctx: Ctx) {
  // Kanvas px (Y turun) → meter CAD (Y naik), relatif terhadap titik dasar block.
  const m = (p: P): P => ({ x: (p.x - ctx.base.x) / ctx.ppm, y: -(p.y - ctx.base.y) / ctx.ppm });
  switch (prim.t) {
    case "line": {
      const a = m(prim.a), b = m(prim.b);
      write(buf, [...entityHead(ctx, "LINE", prim.layer, "AcDbLine", prim.ltype), [10, a.x], [20, a.y], [30, 0], [11, b.x], [21, b.y], [31, 0]]);
      return;
    }
    case "poly": {
      if (prim.pts.length < 2) return;
      const tags = entityHead(ctx, "LWPOLYLINE", prim.layer, "AcDbPolyline", prim.ltype);
      tags.push([90, prim.pts.length], [70, prim.closed ? 1 : 0], [43, 0]);
      for (const point of prim.pts) {
        const p = m(point);
        tags.push([10, p.x], [20, p.y]);
      }
      write(buf, tags);
      return;
    }
    case "arc": {
      const c = m(prim.c), from = m(prim.from), to = m(prim.to);
      let s = Math.atan2(from.y - c.y, from.x - c.x);
      let e = Math.atan2(to.y - c.y, to.x - c.x);
      // ARC DXF selalu CCW; pilih busur minor antara kedua titik.
      let sweep = e - s;
      while (sweep < 0) sweep += Math.PI * 2;
      if (sweep > Math.PI) [s, e] = [e, s];
      const deg = (r: number) => ((r * 180 / Math.PI) % 360 + 360) % 360;
      write(buf, [...entityHead(ctx, "ARC", prim.layer, "AcDbCircle"), [10, c.x], [20, c.y], [30, 0], [40, prim.r / ctx.ppm], [100, "AcDbArc"], [50, deg(s)], [51, deg(e)]]);
      return;
    }
    case "circle": {
      const c = m(prim.c);
      write(buf, [...entityHead(ctx, "CIRCLE", prim.layer, "AcDbCircle"), [10, c.x], [20, c.y], [30, 0], [40, prim.r / ctx.ppm]]);
      return;
    }
    case "hatch": {
      const pattern = prim.pattern === "SOLID" ? null : HATCH_PATTERNS[prim.pattern];
      const solid = pattern === null;
      const tags = entityHead(ctx, "HATCH", prim.layer, "AcDbHatch");
      tags.push([10, 0], [20, 0], [30, 0], [210, 0], [220, 0], [230, 1], [2, pattern ? pattern.name : "SOLID"], [70, solid ? 1 : 0], [71, 0], [91, prim.rings.length]);
      prim.rings.forEach((ring, index) => {
        // Lingkar pertama = batas luar; sisanya lubang/pulau (gaya paritas normal).
        tags.push([92, index === 0 ? 3 : 2], [72, 0], [73, 1], [93, ring.length]);
        for (const point of ring) {
          const p = m(point);
          tags.push([10, p.x], [20, p.y]);
        }
        tags.push([97, 0]);
      });
      tags.push([75, 0], [76, solid ? 1 : 2]);
      if (pattern) {
        tags.push([52, 0], [41, 1], [77, 0], [78, pattern.lines.length]);
        for (const line of pattern.lines) {
          tags.push([53, line.angle], [43, line.base[0]], [44, line.base[1]], [45, line.offset[0]], [46, line.offset[1]], [79, line.dashes.length]);
          for (const dash of line.dashes) tags.push([49, dash]);
        }
      }
      tags.push([98, 0]);
      write(buf, tags);
      return;
    }
    case "text": {
      const p = m(prim.p);
      write(buf, [
        ...entityHead(ctx, "TEXT", prim.layer, "AcDbText"),
        [10, p.x], [20, p.y], [30, 0], [40, prim.h / ctx.ppm], [1, dxfText(prim.text)], [7, DXF_TEXT_STYLE],
        [72, 1], [11, p.x], [21, p.y], [31, 0], [100, "AcDbText"], [73, 2],
      ]);
      return;
    }
  }
}

export const DXF_TEXT_STYLE = "DABIDABI";

const LTYPES: Array<{ name: string; desc: string; pattern: number[] }> = [
  { name: "ByBlock", desc: "", pattern: [] },
  { name: "ByLayer", desc: "", pattern: [] },
  { name: "Continuous", desc: "Solid line", pattern: [] },
  { name: "GRIDCENTER", desc: "Grid center ____ _ ____", pattern: [0.7, -0.3, 0.1, -0.3] },
  { name: "DOORDASH", desc: "Door threshold __ __", pattern: [0.08, -0.06] },
];

function primPoints(prim: Prim): P[] {
  switch (prim.t) {
    case "line": return [prim.a, prim.b];
    case "poly": return prim.pts;
    case "hatch": return prim.rings.flat();
    case "text": return [prim.p];
    default: return [{ x: prim.c.x - prim.r, y: prim.c.y - prim.r }, { x: prim.c.x + prim.r, y: prim.c.y + prim.r }];
  }
}

export function buildDxf(input: DxfExportInput): string {
  return buildDxfFromPrims(buildPlanPrimitives(input), input.pxPerMeter);
}

/** Tulis DXF dari primitive (koordinat kanvas: Y turun, `ppm` unit per meter). */
export function buildDxfFromPrims(prims: Prim[], ppm: number): string {
  const w = new DxfWriter();

  // Kelompokkan primitive per block (urutan kemunculan dipertahankan).
  const blocks = new Map<string, { base: P; prims: Prim[] }>();
  const modelPrims: Prim[] = [];
  for (const prim of prims) {
    if (!prim.block) { modelPrims.push(prim); continue; }
    const group = blocks.get(prim.block) ?? { base: prim.base ?? { x: 0, y: 0 }, prims: [] };
    group.prims.push(prim);
    blocks.set(prim.block, group);
  }

  // Batas gambar (meter CAD).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const prim of prims) for (const point of primPoints(prim)) {
    const x = point.x / ppm, y = -point.y / ppm;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 10; maxY = 10; }

  // Handle tetap untuk tabel, block record, dan objek.
  const h = {
    vportTable: w.handle(), ltypeTable: w.handle(), layerTable: w.handle(), styleTable: w.handle(), viewTable: w.handle(),
    ucsTable: w.handle(), appidTable: w.handle(), dimstyleTable: w.handle(), brTable: w.handle(),
    rootDict: w.handle(), groupDict: w.handle(), layoutDict: w.handle(), mlineDict: w.handle(), plotDict: w.handle(), plotNormal: w.handle(),
    mlineStandard: w.handle(), modelBR: w.handle(), paperBR: w.handle(), modelLayout: w.handle(), paperLayout: w.handle(),
  };
  const blockRecords = [...blocks.keys()].map((name) => ({ name, handle: w.handle() }));

  const tables: string[] = [];
  write(tables, [[0, "SECTION"], [2, "TABLES"]]);
  const table = (name: string, handle: string, count: number, extra: Tag[] = []) =>
    write(tables, [[0, "TABLE"], [2, name], [5, handle], [330, "0"], [100, "AcDbSymbolTable"], [70, count], ...extra]);
  const record = (type: string, owner: string, subclass: string, handleCode = 5): Tag[] =>
    [[0, type], [handleCode, w.handle()], [330, owner], [100, "AcDbSymbolTableRecord"], [100, subclass]];
  const endTab = () => write(tables, [[0, "ENDTAB"]]);

  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const viewH = Math.max(1, (maxY - minY) * 1.1, (maxX - minX) * 1.1 / 1.6);
  table("VPORT", h.vportTable, 1);
  write(tables, [
    ...record("VPORT", h.vportTable, "AcDbViewportTableRecord"), [2, "*Active"], [70, 0],
    [10, 0], [20, 0], [11, 1], [21, 1], [12, cx], [22, cy], [13, 0], [23, 0], [14, 0.5], [24, 0.5], [15, 0.5], [25, 0.5],
    [16, 0], [26, 0], [36, 1], [17, 0], [27, 0], [37, 0], [40, viewH], [41, 1.6], [42, 50], [43, 0], [44, 0], [50, 0], [51, 0],
    [71, 0], [72, 1000], [73, 1], [74, 3], [75, 0], [76, 0], [77, 0], [78, 0],
  ]);
  endTab();

  table("LTYPE", h.ltypeTable, LTYPES.length);
  for (const lt of LTYPES) {
    const tags: Tag[] = [...record("LTYPE", h.ltypeTable, "AcDbLinetypeTableRecord"), [2, lt.name], [70, 0], [3, lt.desc], [72, 65], [73, lt.pattern.length], [40, lt.pattern.reduce((sum, v) => sum + Math.abs(v), 0)]];
    for (const v of lt.pattern) tags.push([49, v], [74, 0]);
    write(tables, tags);
  }
  endTab();

  table("LAYER", h.layerTable, DXF_LAYERS.length);
  for (const layer of DXF_LAYERS) {
    write(tables, [...record("LAYER", h.layerTable, "AcDbLayerTableRecord"), [2, layer.name], [70, 0], [62, layer.color], [6, layer.ltype ?? "Continuous"], [370, -3], [390, h.plotNormal]]);
  }
  endTab();

  table("STYLE", h.styleTable, 2);
  for (const [name, font] of [["Standard", "txt"], [DXF_TEXT_STYLE, "arial.ttf"]]) {
    write(tables, [...record("STYLE", h.styleTable, "AcDbTextStyleTableRecord"), [2, name], [70, 0], [40, 0], [41, 1], [50, 0], [71, 0], [42, 0.25], [3, font], [4, ""]]);
  }
  endTab();
  table("VIEW", h.viewTable, 0); endTab();
  table("UCS", h.ucsTable, 0); endTab();
  table("APPID", h.appidTable, 1);
  write(tables, [...record("APPID", h.appidTable, "AcDbRegAppTableRecord"), [2, "ACAD"], [70, 0]]);
  endTab();
  table("DIMSTYLE", h.dimstyleTable, 1, [[100, "AcDbDimStyleTable"]]);
  write(tables, [...record("DIMSTYLE", h.dimstyleTable, "AcDbDimStyleTableRecord", 105), [2, "Standard"], [70, 0], [40, 1], [41, 0.1], [42, 0.05], [43, 0.1], [44, 0.1], [140, 0.1], [141, 0.1], [147, 0.05]]);
  endTab();
  table("BLOCK_RECORD", h.brTable, 2 + blockRecords.length);
  write(tables, [[0, "BLOCK_RECORD"], [5, h.modelBR], [330, h.brTable], [100, "AcDbSymbolTableRecord"], [100, "AcDbBlockTableRecord"], [2, "*Model_Space"], [340, h.modelLayout]]);
  write(tables, [[0, "BLOCK_RECORD"], [5, h.paperBR], [330, h.brTable], [100, "AcDbSymbolTableRecord"], [100, "AcDbBlockTableRecord"], [2, "*Paper_Space"], [340, h.paperLayout]]);
  for (const br of blockRecords) write(tables, [[0, "BLOCK_RECORD"], [5, br.handle], [330, h.brTable], [100, "AcDbSymbolTableRecord"], [100, "AcDbBlockTableRecord"], [2, br.name], [70, 6]]);
  endTab();
  write(tables, [[0, "ENDSEC"]]);

  // BLOCKS: model/paper space kosong + satu definisi per bagian denah.
  const blocksBuf: string[] = [];
  write(blocksBuf, [[0, "SECTION"], [2, "BLOCKS"]]);
  const blockDef = (name: string, owner: string, base: P, body: () => void) => {
    write(blocksBuf, [[0, "BLOCK"], [5, w.handle()], [330, owner], [100, "AcDbEntity"], [8, "0"], [100, "AcDbBlockBegin"], [2, name], [70, 0], [10, base.x], [20, base.y], [30, 0], [3, name], [1, ""]]);
    body();
    write(blocksBuf, [[0, "ENDBLK"], [5, w.handle()], [330, owner], [100, "AcDbEntity"], [8, "0"], [100, "AcDbBlockEnd"]]);
  };
  blockDef("*Model_Space", h.modelBR, { x: 0, y: 0 }, () => {});
  blockDef("*Paper_Space", h.paperBR, { x: 0, y: 0 }, () => {});
  for (const br of blockRecords) {
    const group = blocks.get(br.name)!;
    // Geometri block relatif terhadap titik dasar; titik dasar block = (0,0).
    blockDef(br.name, br.handle, { x: 0, y: 0 }, () => {
      for (const prim of group.prims) emitPrim(blocksBuf, prim, { w, owner: br.handle, ppm, base: group.base });
    });
  }
  write(blocksBuf, [[0, "ENDSEC"]]);

  // ENTITIES: INSERT tiap block di posisi aslinya, lalu ruang/teks/garis lepas.
  const entities: string[] = [];
  write(entities, [[0, "SECTION"], [2, "ENTITIES"]]);
  const modelCtx: Ctx = { w, owner: h.modelBR, ppm, base: { x: 0, y: 0 } };
  for (const br of blockRecords) {
    const base = blocks.get(br.name)!.base;
    write(entities, [...entityHead(modelCtx, "INSERT", "0", "AcDbBlockReference"), [2, br.name], [10, base.x / ppm], [20, -base.y / ppm], [30, 0]]);
  }
  for (const prim of modelPrims) emitPrim(entities, prim, modelCtx);
  write(entities, [[0, "ENDSEC"]]);

  // OBJECTS: kamus minimal yang dibutuhkan AutoCAD (grup, layout, mline style, plot style).
  const objects: string[] = [];
  write(objects, [[0, "SECTION"], [2, "OBJECTS"]]);
  write(objects, [[0, "DICTIONARY"], [5, h.rootDict], [330, "0"], [100, "AcDbDictionary"], [281, 1],
    [3, "ACAD_GROUP"], [350, h.groupDict], [3, "ACAD_LAYOUT"], [350, h.layoutDict], [3, "ACAD_MLINESTYLE"], [350, h.mlineDict], [3, "ACAD_PLOTSTYLENAME"], [350, h.plotDict]]);
  write(objects, [[0, "DICTIONARY"], [5, h.groupDict], [330, h.rootDict], [100, "AcDbDictionary"], [281, 1]]);
  write(objects, [[0, "DICTIONARY"], [5, h.layoutDict], [330, h.rootDict], [100, "AcDbDictionary"], [281, 1], [3, "Model"], [350, h.modelLayout], [3, "Layout1"], [350, h.paperLayout]]);
  write(objects, [[0, "DICTIONARY"], [5, h.mlineDict], [330, h.rootDict], [100, "AcDbDictionary"], [281, 1], [3, "Standard"], [350, h.mlineStandard]]);
  write(objects, [[0, "ACDBDICTIONARYWDFLT"], [5, h.plotDict], [330, h.rootDict], [100, "AcDbDictionary"], [281, 1], [3, "Normal"], [350, h.plotNormal], [100, "AcDbDictionaryWithDefault"], [340, h.plotNormal]]);
  write(objects, [[0, "ACDBPLACEHOLDER"], [5, h.plotNormal], [330, h.plotDict]]);
  write(objects, [[0, "MLINESTYLE"], [5, h.mlineStandard], [330, h.mlineDict], [100, "AcDbMlineStyle"], [2, "Standard"], [70, 0], [3, ""], [62, 256], [51, 90], [52, 90], [71, 2], [49, 0.5], [62, 256], [6, "BYLAYER"], [49, -0.5], [62, 256], [6, "BYLAYER"]]);
  const layout = (handle: string, name: string, flags: number, order: number, owner: string): Tag[] => [
    [0, "LAYOUT"], [5, handle], [330, h.layoutDict], [100, "AcDbPlotSettings"], [1, ""], [4, "A3"], [6, ""],
    [40, 7.5], [41, 20], [42, 7.5], [43, 20], [44, 420], [45, 297], [46, 0], [47, 0], [48, 0], [49, 0], [140, 0], [141, 0], [142, 1], [143, 1],
    [70, flags], [72, 1], [73, 0], [74, 5], [7, ""], [75, 16], [76, 0], [77, 2], [78, 300], [147, 1], [148, 0], [149, 0],
    [100, "AcDbLayout"], [1, name], [70, 1], [71, order], [10, 0], [20, 0], [11, 420], [21, 297], [12, 0], [22, 0], [32, 0],
    [14, 1e20], [24, 1e20], [34, 1e20], [15, -1e20], [25, -1e20], [35, -1e20], [146, 0], [13, 0], [23, 0], [33, 0],
    [16, 1], [26, 0], [36, 0], [17, 0], [27, 1], [37, 0], [76, 1], [330, owner],
  ];
  write(objects, layout(h.modelLayout, "Model", 1024, 0, h.modelBR));
  write(objects, layout(h.paperLayout, "Layout1", 0, 1, h.paperBR));
  write(objects, [[0, "ENDSEC"]]);

  const header: string[] = [];
  write(header, [
    [0, "SECTION"], [2, "HEADER"],
    [9, "$ACADVER"], [1, "AC1015"],
    [9, "$DWGCODEPAGE"], [3, "ANSI_1252"],
    [9, "$INSBASE"], [10, 0], [20, 0], [30, 0],
    [9, "$EXTMIN"], [10, minX], [20, minY], [30, 0],
    [9, "$EXTMAX"], [10, maxX], [20, maxY], [30, 0],
    [9, "$LTSCALE"], [40, 1],
    [9, "$TEXTSTYLE"], [7, DXF_TEXT_STYLE],
    [9, "$INSUNITS"], [70, 6], // 6 = meter
    [9, "$MEASUREMENT"], [70, 1],
    [9, "$HANDSEED"], [5, w.seed],
    [0, "ENDSEC"],
  ]);
  const classes: string[] = [];
  write(classes, [[0, "SECTION"], [2, "CLASSES"], [0, "ENDSEC"]]);
  const eof: string[] = [];
  write(eof, [[0, "EOF"]]);
  return [...header, ...classes, ...tables, ...blocksBuf, ...entities, ...objects, ...eof].join("\r\n") + "\r\n";
}


// ---------- Download helper ----------

export function downloadDxf(filename: string, content: string) {
  const blob = new Blob([encodeDxf(content) as BlobPart], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".dxf") ? filename : `${filename}.dxf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
