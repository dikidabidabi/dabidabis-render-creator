// DXF potongan 2D dari satu garis potong. Sumber geometri = model Detail 3D full
// (sama dengan slide Potongan 3D). Bidang terpotong = poché + HATCH, elemen di
// belakang bidang = garis tampak. Dikelompokkan sebagai block per jenis elemen.
import polygonClipping from "polygon-clipping";
import { buildFullDetail3d, type Detail3dKind } from "@/lib/level-detail-3d";
import { clipPrismsToSection, mergeCutFaces, section3dFloors, section3dFrame, sectionCoords, sectionCutFaces } from "@/lib/section-3d";
import { buildDxfFromPrims, type DxfHatchKind, type DxfPrim } from "@/lib/dxf-export";

type P = { x: number; y: number };
type Group = { block: string; kinds: Detail3dKind[]; hatch: DxfHatchKind | null; layer: string };

/** Pengelompokan block mengikuti DXF denah (DINDING, KOLOM, PINTU, JENDELA, ...). */
export const SECTION_DXF_GROUPS: Group[] = [
  { block: "DINDING", kinds: ["wall", "concept", "parapet"], hatch: "WALL", layer: "SECTION-CUT" },
  { block: "BETON", kinds: ["concrete", "column"], hatch: "CONCRETE", layer: "SECTION-CUT" },
  { block: "PELAT", kinds: ["slab", "floor"], hatch: "CONCRETE", layer: "SECTION-CUT" },
  { block: "TANGGA", kinds: ["stair"], hatch: "SOLID", layer: "SECTION-CUT" },
  { block: "RAILING", kinds: ["railing"], hatch: null, layer: "SECTION-CUT" },
  { block: "PINTU", kinds: ["door"], hatch: null, layer: "SECTION-OPENING" },
  { block: "JENDELA", kinds: ["glass", "frame"], hatch: null, layer: "SECTION-OPENING" },
  { block: "PLAFON", kinds: ["ceiling", "ceilingFrame"], hatch: null, layer: "SECTION-CUT" },
];

type Rect = Array<Array<[number, number]>>;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
function unionRects(rects: Rect[]): Array<Array<Array<{ s: number; h: number }>>> {
  if (!rects.length) return [];
  let merged: Array<Array<Array<[number, number]>>>;
  try { merged = polygonClipping.union(rects[0] as any, ...(rects.slice(1) as any[])) as any; }
  catch { merged = rects; }
  return merged.map((poly) => poly.map((ring) => {
    const pts = ring.map(([s, h]) => ({ s, h }));
    const f = pts[0], l = pts[pts.length - 1];
    if (f && l && pts.length > 1 && f.s === l.s && f.h === l.h) pts.pop();
    return pts;
  }).filter((r) => r.length >= 3)).filter((p) => p.length);
}

export type SectionDxfSketch = Parameters<typeof buildFullDetail3d>[0] & { levels?: Array<{ id: string; name?: string; mdpl: number; typicalCount?: number; typicalHeight?: number }> };

export function buildSectionPrims(sketch: SectionDxfSketch, cut: { p1: P; p2: P; label?: string }, pxPerMeter: number): DxfPrim[] {
  const frame = section3dFrame(cut.p1, cut.p2, pxPerMeter);
  if (!frame) return [];
  const model = buildFullDetail3d(sketch, pxPerMeter);
  const clipped = clipPrismsToSection(model.prisms, frame);
  const faces = sectionCutFaces(clipped, frame);
  // Kanvas DXF: x = s (m), y = −h (m) → ppm 1, Y CAD naik.
  const pt = (s: number, h: number): P => ({ x: s, y: -h });
  const prims: DxfPrim[] = [];
  let minS = 0, maxS = frame.length;

  for (const g of SECTION_DXF_GROUPS) {
    const cutFaces = faces.filter((f) => g.kinds.includes(f.kind));
    for (const poly of mergeCutFaces(cutFaces)) {
      const rings = poly.map((ring) => ring.map((p) => pt(p.s, p.h)));
      if (g.hatch) prims.push({ t: "hatch", layer: "SECTION-CUT-HATCH", rings, pattern: g.hatch, block: `POTONG-${g.block}`, base: { x: 0, y: 0 } });
      for (const ring of rings) prims.push({ t: "poly", layer: g.layer, pts: ring, closed: true, block: `POTONG-${g.block}`, base: { x: 0, y: 0 } });
    }
    // Tampak: proyeksi elemen di belakang bidang potong.
    const rects: Rect[] = [];
    for (const prism of clipped) {
      if (!g.kinds.includes(prism.kind)) continue;
      const ss = prism.outer.map((p) => sectionCoords(frame, p).s);
      const s0 = Math.min(...ss), s1 = Math.max(...ss);
      if (!(s1 - s0 > 1e-4) || !(prism.top - prism.bottom > 1e-4)) continue;
      minS = Math.min(minS, s0); maxS = Math.max(maxS, s1);
      rects.push([[[r4(s0), r4(prism.bottom)], [r4(s1), r4(prism.bottom)], [r4(s1), r4(prism.top)], [r4(s0), r4(prism.top)]]]);
    }
    for (const poly of unionRects(rects)) for (const ring of poly) {
      prims.push({ t: "poly", layer: "SECTION-BEYOND", pts: ring.map((p) => pt(p.s, p.h)), closed: true, block: `TAMPAK-${g.block}`, base: { x: 0, y: 0 } });
    }
  }

  // Garis & label level.
  const levels = ((sketch.levels ?? []) as Array<{ id: string; name?: string; mdpl: number; typicalCount?: number; typicalHeight?: number }>).map((lv) => ({ ...lv, name: lv.name ?? lv.id, mdpl: Number(lv.mdpl) || 0 }));
  const base0 = Math.min(...levels.map((l) => l.mdpl), 0);
  for (const floor of section3dFloors(levels)) {
    const h = floor.base - (levels.length ? Math.min(...levels.map((l) => l.mdpl)) : base0);
    const a = pt(minS - 1.5, h), b = pt(maxS + 1.5, h);
    prims.push({ t: "line", layer: "SECTION-LEVEL", a, b, block: "LEVEL", base: { x: 0, y: 0 } });
    const label = floor.copies > 1 ? `${floor.name} (${floor.copy + 1})` : floor.name;
    const elev = (floor.base >= 0 ? "+" : "") + floor.base.toFixed(2).replace(".", ",");
    prims.push({ t: "text", layer: "SECTION-TEXT", p: pt(minS - 3, h + 0.25), h: 0.25, text: `${label} ${elev}`, block: "LEVEL", base: { x: 0, y: 0 } });
  }
  const title = `POTONGAN ${cut.label ?? ""}`.trim();
  prims.push({ t: "text", layer: "SECTION-TEXT", p: pt((minS + maxS) / 2, -1.2), h: 0.5, text: title });
  return prims;
}

export function buildSectionDxf(sketch: SectionDxfSketch, cut: { p1: P; p2: P; label?: string }, pxPerMeter: number): string {
  return buildDxfFromPrims(buildSectionPrims(sketch, cut, pxPerMeter), 1);
}
