import {
  boxOutline,
  clipOutline,
  outlineBox,
  ringArea,
  solidFaces,
  validOutline,
  type CladingPoint,
} from "./clading-solid";
import { polygonCladingPrisms } from "./clading-prisms";

export const CLADING_SKIN_M = 0.02;
export const CLADING_FRAME_M = 0.04;
export const CLADING_FRAME_PITCH_M = 0.5;
export const CLADING_JOIN_M = 0.02;
export type CladingBox = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  points?: CladingPoint[];
};
/** x/y in sketch pixels, z relative to the owning level, in meters. */
export type Clading = {
  id: string;
  name: string;
  levelId: string;
  boxes: CladingBox[];
  /** Shared by linked instances; edits to one shape propagate to the others. */
  linkId?: string;
};
export type CladingFace = {
  box: CladingBox;
  axis: "x" | "y" | "z";
  sign: 1 | -1;
  polygon?: CladingPoint[];
  edge?: { a: CladingPoint; b: CladingPoint };
  normal?: CladingPoint;
};
const axes = ["x", "y", "z"] as const;
const validBox = (b: CladingBox) =>
  axes.every(
    (a) => Number.isFinite(b.min[a]) && Number.isFinite(b.max[a]) && b.max[a] - b.min[a] > 0.00001,
  ) &&
  (!b.points || validOutline(b.points));
export { boxOutline, validOutline } from "./clading-solid";
export function normalizeClading(value: unknown): Clading[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    if (!c || typeof c.id !== "string" || typeof c.levelId !== "string" || !Array.isArray(c.boxes))
      return [];
    const boxes = c.boxes
      .filter((b: CladingBox) => b?.min && b?.max && validBox(b))
      .map((b: CladingBox) => (b.points ? outlineBox(b.points, b.min.z, b.max.z) : b));
    return boxes.length
      ? [
          {
            id: c.id,
            name: typeof c.name === "string" ? c.name : "Clading",
            levelId: c.levelId,
            boxes,
            ...(typeof c.linkId === "string" && c.linkId ? { linkId: c.linkId } : {}),
          },
        ]
      : [];
  });
}
export function cladingVolume(c: Clading) {
  return c.boxes.reduce((v, b) => v + Math.abs(ringArea(boxOutline(b))) * (b.max.z - b.min.z), 0);
}
export function mergeClading(items: Clading[], ppm: number): Clading[] {
  const result = items.map((c) => ({ ...c, boxes: [...c.boxes] }));
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < result.length && !again; i++)
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i],
          b = result[j];
        if (!a || !b || a.levelId !== b.levelId) continue;
        const touching = a.boxes.some((u) =>
          b.boxes.some((v) => {
            if (
              !axes.every((axis) => {
                const gap = CLADING_JOIN_M * (axis === "z" ? 1 : ppm);
                return u.min[axis] <= v.max[axis] + gap && v.min[axis] <= u.max[axis] + gap;
              })
            )
              return false;
            const A = boxOutline(u),
              B = boxOutline(v);
            if (clipOutline(A, B).length) return true;
            const distance = (p: CladingPoint, q: CladingPoint, r: CladingPoint) => {
              const dx = r.x - q.x,
                dy = r.y - q.y,
                l = dx * dx + dy * dy,
                t = l ? Math.max(0, Math.min(1, ((p.x - q.x) * dx + (p.y - q.y) * dy) / l)) : 0;
              return Math.hypot(p.x - q.x - t * dx, p.y - q.y - t * dy);
            };
            return (
              A.some((p) =>
                B.some((q, k) => {
                  const r = B[(k + 1) % B.length];
                  return r && distance(p, q, r) <= CLADING_JOIN_M * ppm + 1e-7;
                }),
              ) ||
              B.some((p) =>
                A.some((q, k) => {
                  const r = A[(k + 1) % A.length];
                  return r && distance(p, q, r) <= CLADING_JOIN_M * ppm + 1e-7;
                }),
              )
            );
          }),
        );
        if (!touching) continue;
        const large = cladingVolume(a) >= cladingVolume(b) ? a : b;
        result[i] = { ...large, boxes: [...a.boxes, ...b.boxes] };
        result.splice(j, 1);
        again = true;
        break;
      }
  }
  return result;
}
export const cladingFaces = solidFaces;
export const cladingPrisms = polygonCladingPrisms;
export function snapCladingDistance(distance: number, gridStep: number): number {
  return Number.isFinite(distance) && Number.isFinite(gridStep) && gridStep > 0
    ? Math.round(distance / gridStep) * gridStep
    : 0;
}
export function moveClading(item: Clading, dx: number, dy: number, dz = 0): Clading {
  return {
    ...item,
    boxes: item.boxes.map((b) =>
      outlineBox(
        boxOutline(b).map((p) => ({ x: p.x + dx, y: p.y + dy })),
        b.min.z + dz,
        b.max.z + dz,
      ),
    ),
  };
}
export function editCladingPoint(
  item: Clading,
  boxIndex: number,
  index: number,
  point: CladingPoint | null,
): Clading {
  const box = item.boxes[boxIndex];
  if (!box) return item;
  const points = boxOutline(box).flatMap((p, i) => (i === index ? (point ? [point] : []) : [p]));
  if (!validOutline(points)) return item;
  return {
    ...item,
    boxes: item.boxes.map((b, i) => (i === boxIndex ? outlineBox(points, b.min.z, b.max.z) : b)),
  };
}
export function addCladingPoint(
  item: Clading,
  boxIndex: number,
  index: number,
  point: CladingPoint,
): Clading {
  const box = item.boxes[boxIndex];
  if (!box) return item;
  const points = [...boxOutline(box)];
  points.splice(index + 1, 0, point);
  if (!validOutline(points)) return item;
  return {
    ...item,
    boxes: item.boxes.map((b, i) => (i === boxIndex ? outlineBox(points, b.min.z, b.max.z) : b)),
  };
}
export function extrudeClading(
  item: Clading,
  face: CladingFace,
  distance: number,
  ppm: number,
): Clading {
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-7) return item;
  let polygon: CladingPoint[], bottom: number, top: number;
  if (face.edge && face.normal) {
    const { a, b } = face.edge,
      n = face.normal,
      d = distance * ppm;
    polygon = [
      a,
      b,
      { x: b.x + n.x * d, y: b.y + n.y * d },
      { x: a.x + n.x * d, y: a.y + n.y * d },
    ];
    bottom = face.box.min.z;
    top = face.box.max.z;
  } else if (face.axis === "z") {
    polygon = face.polygon ?? boxOutline(face.box);
    const surface = face.sign > 0 ? face.box.max.z : face.box.min.z,
      other = surface + distance * face.sign;
    bottom = Math.min(surface, other);
    top = Math.max(surface, other);
  } else {
    // Legacy axis-aligned face callers.
    const box = structuredClone(face.box),
      axis = face.axis,
      surface = face.sign > 0 ? box.max[axis] : box.min[axis],
      other = surface + distance * ppm * face.sign;
    box.min[axis] = Math.min(surface, other);
    box.max[axis] = Math.max(surface, other);
    polygon = boxOutline(box);
    bottom = box.min.z;
    top = box.max.z;
  }
  if (distance > 0) return { ...item, boxes: [...item.boxes, outlineBox(polygon, bottom, top)] };
  const boxes = item.boxes.flatMap((b) => {
    const lo = Math.max(bottom, b.min.z),
      hi = Math.min(top, b.max.z);
    if (hi <= lo) return [b];
    const remaining: CladingBox[] = [];
    if (b.min.z < lo) remaining.push(outlineBox(boxOutline(b), b.min.z, lo));
    if (hi < b.max.z) remaining.push(outlineBox(boxOutline(b), hi, b.max.z));
    for (const ring of clipOutline(boxOutline(b), polygon, true))
      remaining.push(outlineBox(ring, lo, hi));
    return remaining;
  });
  return boxes.length ? { ...item, boxes } : item;
}
export function extrudeCladingFaces(
  item: Clading,
  faces: CladingFace[],
  distance: number,
  ppm: number,
): Clading {
  return faces.reduce((next, face) => extrudeClading(next, face, distance, ppm), item);
}
