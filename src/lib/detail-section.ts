import { buildLevelDetail3d, detail3dInputForSketch, type Detail3dKind, type Detail3dPrism } from "./level-detail-3d";
import { clipPrismsToSection, mergeCutFaces, section3dBeams, section3dCeilings, section3dFloors, section3dFrame, sectionCoords, sectionCutFaces } from "./section-3d";
import { axisPositions, collectGrids, gridWorldToLocal, xAxisLabelAt, yAxisLabelAt, type StructuralGrid } from "./structural-grid";
import { sectionVisibleLines } from "./section-visibility";

type Point = { x: number; y: number };
export type DetailSectionCut = { p1: Point; p2: Point; label?: string; showDetailSlide?: boolean };
export type DetailSectionSketch = Omit<Parameters<typeof detail3dInputForSketch>[0], "levels"> & { levels?: Array<{ id: string; name?: string; mdpl: number; typicalCount?: number; typicalHeight?: number }> };
export const detailSectionEnabled = (cut: DetailSectionCut) => cut.showDetailSlide === true;

/** Ground-floor datum, independent of the site's absolute elevation. */
export function detailSectionFloorDatum(floors: Array<{ name: string; base: number }>) {
  const ground = floors.find(floor => /lantai\s*dasar|ground/i.test(floor.name));
  return ground?.base ?? [...floors].sort((a, b) => Math.abs(a.base) - Math.abs(b.base))[0]?.base ?? 0;
}

export const detailSectionElevation = (height: number, datum: number) => Math.round((height - datum) * 1000) / 1000;
export const formatSectionElevation = (height: number) => `${height < 0 ? "−" : "+"}${Math.abs(height).toFixed(3)}`;

/** Intersect the section with grid axes in the grid's rotated local frame. */
export function detailSectionGridHits(grids: StructuralGrid[], cut: DetailSectionCut, ppm: number) {
  const length = Math.hypot(cut.p2.x - cut.p1.x, cut.p2.y - cut.p1.y) / ppm;
  const hits: Array<{ s: number; label: string; key: string }> = [];
  grids.forEach((grid, gi) => {
    const a = gridWorldToLocal(grid, cut.p1, ppm), b = gridWorldToLocal(grid, cut.p2, ppm);
    const add = (axis: "x" | "y", positions: number[]) => positions.forEach((v, i) => {
      if ((i === 0 && (axis === "x" ? grid.hideBubbleStartX : grid.hideBubbleStartY)) || (i === positions.length - 1 && (axis === "x" ? grid.hideBubbleEndX : grid.hideBubbleEndY))) return;
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-8) return;
      const t = (v - a[axis]) / delta;
      if (t < 0 || t > 1) return;
      hits.push({ s: t * length, label: axis === "x" ? xAxisLabelAt(i, grid.labelOffsetX ?? 0) : yAxisLabelAt(i, grid.labelOffsetY ?? 0), key: `${gi}-${axis}-${i}` });
    });
    add("x", axisPositions(grid.spansX));
    if (!grid.lineOnly) add("y", axisPositions(grid.spansY));
  });
  return hits.sort((a, b) => a.s - b.s).filter((hit, i, all) => i === 0 || Math.abs(hit.s - (all[i - 1]?.s ?? 0)) > 0.001);
}

export function buildDetailSection(sketch: DetailSectionSketch, cut: DetailSectionCut, ppm: number) {
  const frame = section3dFrame(cut.p1, cut.p2, ppm);
  if (!frame) return null;
  const levels = (sketch.levels ?? []).map(lv => ({ ...lv, name: lv.name ?? lv.id }));
  const floors = section3dFloors(levels);
  const datum = detailSectionFloorDatum(floors);
  const grids = collectGrids(sketch.structuralGrid, sketch.structuralGridExtras);
  const slabs = sketch.floors ?? [];
  const prisms: Detail3dPrism[] = [];
  const ceilingDimensions: Array<{ s: number; base: number; head: number }> = [];
  const rooms: Array<{ key: string; name: string; s0: number; s1: number; base: number; ffl: number }> = [];
  floors.forEach((floor, index) => {
    const input = detail3dInputForSketch(sketch, floor.levelId, ppm);
    const next = floors[index + 1];
    for (const [roomIndex, room] of input.rooms.entries()) {
      if (room.points.length < 3 || /^(lahan|void)/i.test(room.name)) continue;
      const roomPrism: Detail3dPrism = { kind: "floor", outer: room.points.map(p => ({ x: p.x / ppm, y: p.y / ppm })), holes: [], bottom: 0, top: 0.01 };
      for (const [partIndex, face] of sectionCutFaces(clipPrismsToSection([roomPrism], frame), frame).entries()) {
        const s0 = Math.max(0, face.s0), s1 = Math.min(frame.length, face.s1);
        if (s1 - s0 < 0.1) continue;
        rooms.push({ key: `${floor.key}-${roomIndex}-${partIndex}`, name: room.name, s0, s1, base: floor.base, ffl: detailSectionElevation(floor.base, datum) });
      }
    }
    const ceilings = next ? section3dCeilings(input.rooms, slabs.filter(s => s.levelId === next.levelId), ppm, next.base - floor.base) : [];
    const parts = [...buildLevelDetail3d(input, { capUnderUpper: true }).prisms, ...section3dBeams(slabs.filter(s => s.levelId === floor.levelId), grids, ppm), ...ceilings];
    for (const face of sectionCutFaces(clipPrismsToSection(ceilings.filter(p => p.kind === "ceiling"), frame), frame)) {
      ceilingDimensions.push({ s: (face.s0 + face.s1) / 2, base: floor.base, head: floor.base + face.bottom });
    }
    for (const p of parts) {
      if (floor.copy > 0 && (p.kind === "clading" || p.kind === "cladingFrame")) continue;
      prisms.push({ ...p, bottom: p.bottom + floor.base, top: p.top + floor.base, ...(p.soffit ? { soffit: { ...p.soffit, h0: p.soffit.h0 + floor.base, min: p.soffit.min + floor.base } } : {}) });
    }
  });
  const clipped = clipPrismsToSection(prisms, frame);
  const faces = sectionCutFaces(clipped, frame);
  const kinds = [...new Set(faces.map(f => f.kind))];
  const groups = kinds.map(kind => ({ kind, polygons: mergeCutFaces(faces.filter(f => f.kind === kind)) }));
  const beyond = clipped.map(p => {
    const ss = p.outer.map(q => sectionCoords(frame, q).s);
    return { kind: p.kind, s0: Math.min(...ss), s1: Math.max(...ss), bottom: p.bottom, top: p.top };
  });
  const visibleLines = sectionVisibleLines(clipped, frame);
  const points = [...visibleLines.flatMap(line => [line.a, line.b]), ...groups.flatMap(group => group.polygons.flatMap(poly => poly.flat()))];
  const minS = points.length ? Math.min(...points.map(p => p.s)) : 0, maxS = points.length ? Math.max(...points.map(p => p.s)) : frame.length;
  const minH = points.length ? Math.min(...points.map(p => p.h)) : 0, maxH = points.length ? Math.max(...points.map(p => p.h)) : 3;
  return { groups, beyond, visibleLines, floors, rooms, datum, ceilingDimensions, grids: detailSectionGridHits(grids, cut, ppm).filter(hit => hit.s >= minS - 0.01 && hit.s <= maxS + 0.01), minS, maxS, minH, maxH };
}

export function detailSectionHatch(kind: Detail3dKind): "wall" | "concrete" | null {
  if (["wall", "concept", "parapet"].includes(kind)) return "wall";
  if (["concrete", "column", "slab", "floor", "stair"].includes(kind)) return "concrete";
  return null;
}