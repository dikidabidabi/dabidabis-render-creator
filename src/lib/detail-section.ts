import { buildLevelDetail3d, detail3dInputForSketch, type Detail3dKind, type Detail3dPrism } from "./level-detail-3d";
import { clipPrismsToSection, mergeCutFaces, section3dBeams, section3dCeilings, section3dFloors, section3dFrame, sectionCoords, sectionCutFaces } from "./section-3d";
import { axisPositions, collectGrids, gridWorldToLocal, xAxisLabelAt, yAxisLabelAt, type StructuralGrid } from "./structural-grid";

type Point = { x: number; y: number };
export type DetailSectionCut = { p1: Point; p2: Point; label?: string; showDetailSlide?: boolean };
export type DetailSectionSketch = Omit<Parameters<typeof detail3dInputForSketch>[0], "levels"> & { levels?: Array<{ id: string; name?: string; mdpl: number; typicalCount?: number; typicalHeight?: number }> };
export const detailSectionEnabled = (cut: DetailSectionCut) => cut.showDetailSlide === true;

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
  const grids = collectGrids(sketch.structuralGrid, sketch.structuralGridExtras);
  const slabs = sketch.floors ?? [];
  const prisms: Detail3dPrism[] = [];
  const ceilingDimensions: Array<{ s: number; base: number; head: number }> = [];
  floors.forEach((floor, index) => {
    const input = detail3dInputForSketch(sketch, floor.levelId, ppm);
    const next = floors[index + 1];
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
  const minS = Math.min(0, ...beyond.map(p => p.s0)), maxS = Math.max(frame.length, ...beyond.map(p => p.s1));
  const minH = Math.min(0, ...beyond.map(p => p.bottom)), maxH = Math.max(3, ...beyond.map(p => p.top));
  return { groups, beyond, floors, ceilingDimensions, grids: detailSectionGridHits(grids, cut, ppm), minS, maxS, minH, maxH };
}

export function detailSectionHatch(kind: Detail3dKind): "wall" | "concrete" | null {
  if (["wall", "concept", "parapet"].includes(kind)) return "wall";
  if (["concrete", "column", "slab", "floor", "stair"].includes(kind)) return "concrete";
  return null;
}