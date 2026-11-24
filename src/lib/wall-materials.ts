// Tebal dan geometri pita dinding bersama untuk slide denah/detail dan ekspor DXF.
import { computeStraightSegments, edgeMaterialForSegment, type EdgeMaterial, type EdgeSegment, type Point } from "@/lib/edge-segments";

/** Tebal dinding (mm) per material Pick Material. */
export const WALL_THICK_MM: Record<EdgeMaterial, number> = {
  solid: 150,
  standard150: 150,
  concrete150: 150,
  concrete200: 200,
  concrete250: 250,
  concrete300: 300,
  concrete350: 350,
  concept: 150,
  curtain: 80,
  window: 150,
  railing: 100,
  parapet: 150,
};

export type WallBandMaterial = "solid" | "standard150" | "concrete150" | "concrete200" | "concrete250" | "concrete300" | "concrete350";

export function isWallBandMaterial(material: EdgeMaterial | undefined): material is WallBandMaterial {
  return material === "solid" || material === "standard150" || material === "concrete150" || material === "concrete200"
    || material === "concrete250" || material === "concrete300" || material === "concrete350";
}

export function isConcreteMaterial(material: EdgeMaterial | undefined): boolean {
  return typeof material === "string" && material.startsWith("concrete");
}

type SegmentLine = { a: Point; b: Point; levelId?: string };

/** Material segmen: atribut segmen persis, lalu atribut garis sumbernya. */
export function materialForEdgeSegment(
  segment: EdgeSegment,
  sourceLines: SegmentLine[],
  edgeAttrs: Record<string, EdgeMaterial>,
): EdgeMaterial | undefined {
  const exact = edgeMaterialForSegment(edgeAttrs, segment);
  if (exact) return exact;
  const source = sourceLines[segment.sourceLineIndex];
  return source ? edgeMaterialForSegment(edgeAttrs, source) : undefined;
}

/** Persegi panjang pita dinding selebar 2 × halfWidth, diperpanjang di kedua ujung. */
export function wallBandPolygon(segment: Pick<EdgeSegment, "a" | "b"> & Partial<EdgeSegment>, halfWidth: number, endExtension: number): Point[] {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length, uy = dy / length;
  const nx = -dy / length, ny = dx / length;
  const start = { x: segment.a.x - ux * endExtension, y: segment.a.y - uy * endExtension };
  const end = { x: segment.b.x + ux * endExtension, y: segment.b.y + uy * endExtension };
  return [
    { x: start.x + nx * halfWidth, y: start.y + ny * halfWidth },
    { x: end.x + nx * halfWidth, y: end.y + ny * halfWidth },
    { x: end.x - nx * halfWidth, y: end.y - ny * halfWidth },
    { x: start.x - nx * halfWidth, y: start.y - ny * halfWidth },
  ];
}

/** Dinding ber-material sebagai acuan tebal kusen jendela/pintu. */
export function windowWallCandidates(
  lines?: Array<SegmentLine & { kind?: "straight" | "arc" | "bezier" }>,
  edgeAttrs?: Record<string, EdgeMaterial>,
) {
  if (!lines || !edgeAttrs) return [];
  return computeStraightSegments(lines).flatMap((segment) => {
    const material = materialForEdgeSegment(segment, lines, edgeAttrs);
    return material ? [{ a: segment.a, b: segment.b, thicknessMm: WALL_THICK_MM[material] }] : [];
  });
}
