// DXF (R12 ASCII) untuk denah sketsa, mengikuti notasi Slide Detail.
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

export type DxfLayerPoly = { name: string; points: DxfPoint[] };

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

type Prim =
  | { t: "poly"; layer: string; pts: P[]; closed: boolean; ltype?: string }
  | { t: "line"; layer: string; a: P; b: P; ltype?: string }
  | { t: "arc"; layer: string; c: P; r: number; from: P; to: P }
  | { t: "circle"; layer: string; c: P; r: number }
  | { t: "fill"; layer: string; pts: P[] }
  | { t: "text"; layer: string; p: P; h: number; text: string };

export const DXF_LAYERS: Array<{ name: string; color: number; ltype?: string }> = [
  { name: "0", color: 7 },
  { name: "SKETCH-LINE", color: 8 },
  { name: "WALL-SOLID", color: 7 },
  { name: "WALL-SOLID-CORE", color: 8 },
  { name: "WALL-SOLID-HATCH", color: 9 },
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
  { name: "PARKING-LOT", color: 5 },
  { name: "PARKING-AREA", color: 8 },
  { name: "PARKING-PATH", color: 1 },
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

export type DxfPlanGeometry = { prims: Prim[] };

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
  // Arsir dinding solid: pasangan garis 45°, jarak 40 mm, berulang tiap 150 mm.
  const hatchPeriod = Math.max(1.8, ppm * 0.15);
  for (const [a, b] of hatchSegments(solidCore, 45, hatchPeriod, [hatchPeriod * 0.1, hatchPeriod * (0.1 + 4 / 15)])) {
    prims.push({ t: "line", layer: "WALL-SOLID-HATCH", a, b });
  }
  pushShape(concreteOuterCut, "WALL-CONCRETE");
  pushShape(concreteCore, "WALL-CONCRETE-CORE");

  // Material non-masif (konsep, curtain wall, jendela material, railing).
  for (const { a, b, material } of otherSegments) {
    const half = bandHalf(material);
    const ring = rectAlong(a, b, half, half, half);
    const [a1, b1, b2, a2] = ring;
    if (material === "concept") {
      prims.push({ t: "fill", layer: "WALL-CONCEPT", pts: ring });
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

  // ---- Kolom ----
  for (const { ring, circle } of columnRings) {
    prims.push({ t: "fill", layer: "COLUMN", pts: ring });
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
      prims.push({ t: "fill", layer: "COLUMN-PRACTICAL", pts: square(0) });
      prims.push({ t: "poly", layer: "COLUMN-PRACTICAL", pts: square(0), closed: true });
    }
  }

  // ---- Pintu (kusen 50 mm, daun 40 mm) ----
  const leafThickness = DXF_DOOR_LEAF_MM / 1000 * ppm;
  for (const door of doors) prims.push(...doorPrimitives(door, ppm, attachedDepth(door.a, door.b), jamb, leafThickness));

  // ---- Jendela ----
  for (const window of windows) {
    const geometry = windowPlanGeometry(window, ppm, windowWalls);
    if (!geometry) continue;
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
  }

  // ---- Grid struktur ----
  for (const grid of grids) prims.push(...gridPrimitives(grid, levelId, ppm));

  // ---- Ruang ----
  for (const layer of input.layers) {
    if (!layer.points || layer.points.length < 3) continue;
    prims.push({ t: "poly", layer: "ROOM", pts: layer.points, closed: true });
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

// ---------- Penulis DXF ----------

function code(buf: string[], g: number, v: string | number) {
  buf.push(String(g));
  buf.push(typeof v === "number" ? formatNum(v) : v);
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(6).replace(/\.?0+$/, "") || "0";
}

function emitPrim(buf: string[], prim: Prim, ppm: number) {
  const m = (p: P): P => ({ x: p.x / ppm, y: -p.y / ppm });
  switch (prim.t) {
    case "line": {
      const a = m(prim.a), b = m(prim.b);
      code(buf, 0, "LINE"); code(buf, 8, prim.layer);
      if (prim.ltype) code(buf, 6, prim.ltype);
      code(buf, 10, a.x); code(buf, 20, a.y); code(buf, 30, 0);
      code(buf, 11, b.x); code(buf, 21, b.y); code(buf, 31, 0);
      return;
    }
    case "poly": {
      if (prim.pts.length < 2) return;
      // R12 tidak mengenal LWPOLYLINE — pakai POLYLINE / VERTEX / SEQEND.
      code(buf, 0, "POLYLINE"); code(buf, 8, prim.layer);
      if (prim.ltype) code(buf, 6, prim.ltype);
      code(buf, 66, 1); code(buf, 70, prim.closed ? 1 : 0);
      code(buf, 10, 0); code(buf, 20, 0); code(buf, 30, 0);
      for (const point of prim.pts) {
        const p = m(point);
        code(buf, 0, "VERTEX"); code(buf, 8, prim.layer);
        code(buf, 10, p.x); code(buf, 20, p.y); code(buf, 30, 0);
      }
      code(buf, 0, "SEQEND"); code(buf, 8, prim.layer);
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
      code(buf, 0, "ARC"); code(buf, 8, prim.layer);
      code(buf, 10, c.x); code(buf, 20, c.y); code(buf, 30, 0);
      code(buf, 40, prim.r / ppm);
      code(buf, 50, deg(s)); code(buf, 51, deg(e));
      return;
    }
    case "circle": {
      const c = m(prim.c);
      code(buf, 0, "CIRCLE"); code(buf, 8, prim.layer);
      code(buf, 10, c.x); code(buf, 20, c.y); code(buf, 30, 0);
      code(buf, 40, prim.r / ppm);
      return;
    }
    case "fill": {
      // Isian padat poligon cembung: kipas SOLID segitiga (titik ke-4 = ke-3).
      const pts = prim.pts.map(m);
      for (let i = 1; i + 1 < pts.length; i++) {
        const tri = [pts[0], pts[i], pts[i + 1], pts[i + 1]];
        code(buf, 0, "SOLID"); code(buf, 8, prim.layer);
        tri.forEach((p, k) => { code(buf, 10 + k, p.x); code(buf, 20 + k, p.y); code(buf, 30 + k, 0); });
      }
      return;
    }
    case "text": {
      const p = m(prim.p);
      code(buf, 0, "TEXT"); code(buf, 8, prim.layer);
      code(buf, 10, p.x); code(buf, 20, p.y); code(buf, 30, 0);
      code(buf, 40, prim.h / ppm);
      code(buf, 1, prim.text);
      code(buf, 72, 1); code(buf, 73, 2);
      code(buf, 11, p.x); code(buf, 21, p.y); code(buf, 31, 0);
      return;
    }
  }
}

export function buildDxf(input: DxfExportInput): string {
  const prims = buildPlanPrimitives(input);
  const buf: string[] = [];

  code(buf, 0, "SECTION"); code(buf, 2, "HEADER");
  code(buf, 9, "$ACADVER"); code(buf, 1, "AC1009");
  code(buf, 9, "$INSUNITS"); code(buf, 70, 6); // 6 = meter
  code(buf, 9, "$MEASUREMENT"); code(buf, 70, 1);
  code(buf, 9, "$LTSCALE"); code(buf, 40, 1);
  code(buf, 0, "ENDSEC");

  code(buf, 0, "SECTION"); code(buf, 2, "TABLES");
  const ltypes: Array<{ name: string; desc: string; pattern: number[] }> = [
    { name: "CONTINUOUS", desc: "Solid line", pattern: [] },
    { name: "GRIDCENTER", desc: "Grid center ____ _ ____", pattern: [0.7, -0.3, 0.1, -0.3] },
    { name: "DOORDASH", desc: "Door threshold __ __", pattern: [0.08, -0.06] },
  ];
  code(buf, 0, "TABLE"); code(buf, 2, "LTYPE"); code(buf, 70, ltypes.length);
  for (const lt of ltypes) {
    code(buf, 0, "LTYPE"); code(buf, 2, lt.name); code(buf, 70, 0);
    code(buf, 3, lt.desc); code(buf, 72, 65); code(buf, 73, lt.pattern.length);
    code(buf, 40, lt.pattern.reduce((sum, v) => sum + Math.abs(v), 0));
    for (const v of lt.pattern) code(buf, 49, v);
  }
  code(buf, 0, "ENDTAB");
  code(buf, 0, "TABLE"); code(buf, 2, "LAYER"); code(buf, 70, DXF_LAYERS.length);
  for (const layer of DXF_LAYERS) {
    code(buf, 0, "LAYER"); code(buf, 2, layer.name); code(buf, 70, 0);
    code(buf, 62, layer.color); code(buf, 6, layer.ltype ?? "CONTINUOUS");
  }
  code(buf, 0, "ENDTAB");
  code(buf, 0, "ENDSEC");

  code(buf, 0, "SECTION"); code(buf, 2, "BLOCKS"); code(buf, 0, "ENDSEC");

  code(buf, 0, "SECTION"); code(buf, 2, "ENTITIES");
  for (const prim of prims) emitPrim(buf, prim, input.pxPerMeter);
  code(buf, 0, "ENDSEC");
  code(buf, 0, "EOF");
  return buf.join("\r\n") + "\r\n";
}

// ---------- Download helper ----------

export function downloadDxf(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".dxf") ? filename : `${filename}.dxf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
