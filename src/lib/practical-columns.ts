// Kolom praktis 150 × 150 mm pada ujung terbuka, sudut, dan pertemuan T
// dinding Solid/standar 150 mm. Dipakai slide detail dan ekspor DXF.
import { computeStraightSegments, edgeMaterialForSegment, segmentIdFor, type EdgeMaterial, type EdgeSegment, type Point } from "@/lib/edge-segments";
import { curveEndDirections, sampleCurveLine, type CurveLine } from "@/lib/curve-wall";
import { materialForEdgeSegment } from "@/lib/wall-materials";

type PlanLine = CurveLine & { levelId?: string };

export type PracticalColumnNode = { point: Point; standard: boolean };

export function practicalColumnNodes({
  lines,
  segmentationLines,
  levelId,
  edgeAttrs,
}: {
  lines: PlanLine[];
  segmentationLines?: PlanLine[];
  levelId?: string;
  edgeAttrs: Record<string, EdgeMaterial>;
}): PracticalColumnNode[] {
  const segmentSource = segmentationLines ?? lines;
  const visibleLineIds = new Set(lines.map((line) => segmentIdFor(line.a, line.b)));
  const solidSegments = computeStraightSegments(
    segmentSource.map((line) => ({ a: line.a, b: line.b, kind: line.kind, levelId: line.levelId })),
  ).filter((segment) => {
    const source = segmentSource[segment.sourceLineIndex];
    if (!source || (levelId && segment.levelId !== levelId)) return false;
    if (!visibleLineIds.has(segmentIdFor(source.a, source.b))) return false;
    const material = materialForEdgeSegment(segment, segmentSource, edgeAttrs);
    return material === "solid" || material === "standard150";
  });
  const nodes = new Map<string, { point: Point; directions: Point[]; standard: boolean }>();
  const addEndpoint = (point: Point, other: Point, standard: boolean) => {
    const length = Math.hypot(other.x - point.x, other.y - point.y);
    if (length < 1e-6) return;
    const key = `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;
    const entry = nodes.get(key) ?? { point, directions: [], standard: false };
    entry.directions.push({ x: (other.x - point.x) / length, y: (other.y - point.y) / length });
    entry.standard ||= standard;
    nodes.set(key, entry);
  };
  for (const segment of solidSegments) {
    const standard = materialForEdgeSegment(segment, segmentSource, edgeAttrs) === "standard150";
    addEndpoint(segment.a, segment.b, standard);
    addEndpoint(segment.b, segment.a, standard);
  }
  // Pertemuan T: endpoint satu dinding berada di tengah dinding lain.
  const addContainingDirections = (point: Point, owner: EdgeSegment) => {
    for (const segment of solidSegments) {
      if (segment === owner) continue;
      const dx = segment.b.x - segment.a.x;
      const dy = segment.b.y - segment.a.y;
      const length2 = dx * dx + dy * dy;
      if (length2 < 1e-9) continue;
      const t = ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / length2;
      if (t <= 1e-5 || t >= 1 - 1e-5) continue;
      const projected = { x: segment.a.x + dx * t, y: segment.a.y + dy * t };
      if (Math.hypot(projected.x - point.x, projected.y - point.y) > 1e-3) continue;
      const standard = materialForEdgeSegment(segment, segmentSource, edgeAttrs) === "standard150";
      addEndpoint(point, segment.a, standard);
      addEndpoint(point, segment.b, standard);
    }
  };
  for (const segment of solidSegments) {
    addContainingDirections(segment.a, segment);
    addContainingDirections(segment.b, segment);
  }
  // Ujung garis lengkung/tangent ber-material solid ikut menentukan kolom praktis.
  for (const line of lines) {
    if ((line.kind ?? "straight") === "straight") continue;
    if (levelId && line.levelId && line.levelId !== levelId) continue;
    const material = edgeMaterialForSegment(edgeAttrs, line);
    if (material !== "solid" && material !== "standard150") continue;
    const points = sampleCurveLine(line);
    const directions = curveEndDirections(points);
    if (!directions) continue;
    const start = points[0], end = points[points.length - 1];
    const standard = material === "standard150";
    addEndpoint(start, { x: start.x + directions.start.x, y: start.y + directions.start.y }, standard);
    addEndpoint(end, { x: end.x + directions.end.x, y: end.y + directions.end.y }, standard);
    const pseudo = { id: "curve", a: start, b: end, sourceLineIndex: -1 } as EdgeSegment;
    addContainingDirections(start, pseudo);
    addContainingDirections(end, pseudo);
  }
  return [...nodes.values()].filter(({ directions }) => {
    const uniqueDirections = directions.filter((direction, index) => !directions.slice(0, index).some((candidate) =>
      candidate.x * direction.x + candidate.y * direction.y > 0.999,
    ));
    // Satu arah = ujung terbuka; dua arah atau lebih hanya pada sudut/T.
    if (uniqueDirections.length === 1) return true;
    if (uniqueDirections.length < 2) return false;
    for (let i = 0; i < uniqueDirections.length; i++) {
      for (let j = i + 1; j < uniqueDirections.length; j++) {
        const dot = Math.abs(uniqueDirections[i].x * uniqueDirections[j].x + uniqueDirections[i].y * uniqueDirections[j].y);
        if (dot < 0.985) return true;
      }
    }
    return false;
  }).map(({ point, standard }) => ({ point, standard }));
}
