import type { Detail3dPrism } from "./level-detail-3d";

export const CLADING_SKIN_M = 0.02;
export const CLADING_FRAME_M = 0.04;
export const CLADING_FRAME_PITCH_M = 0.5;
export const CLADING_JOIN_M = 0.02;
export type CladingBox = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
/** x/y in sketch pixels, z in absolute elevation meters. Independent of room layers. */
export type Clading = { id: string; name: string; levelId: string; boxes: CladingBox[] };
export type CladingFace = { box: CladingBox; axis: "x" | "y" | "z"; sign: 1 | -1 };
const axes = ["x", "y", "z"] as const;
const validBox = (b: CladingBox) => axes.every((a) => Number.isFinite(b.min[a]) && Number.isFinite(b.max[a]) && b.max[a] - b.min[a] > 0.00001);
export function normalizeClading(value: unknown): Clading[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    if (!c || typeof c.id !== "string" || typeof c.levelId !== "string" || !Array.isArray(c.boxes)) return [];
    const boxes = c.boxes.filter((b: CladingBox) => b?.min && b?.max && validBox(b));
    return boxes.length ? [{ id: c.id, name: typeof c.name === "string" ? c.name : "Clading", levelId: c.levelId, boxes }] : [];
  });
}
export function cladingVolume(c: Clading) { return c.boxes.reduce((v, b) => v + axes.reduce((n, a) => n * (b.max[a] - b.min[a]), 1), 0); }
export function mergeClading(items: Clading[], ppm: number): Clading[] {
  const result = items.map((c) => ({ ...c, boxes: [...c.boxes] }));
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < result.length && !again; i++) for (let j = i + 1; j < result.length; j++) {
      const a = result[i], b = result[j];
      if (!a || !b || a.levelId !== b.levelId) continue;
      const touching = a.boxes.some((u) => b.boxes.some((v) => axes.every((axis) => {
        const gap = CLADING_JOIN_M * (axis === "z" ? 1 : ppm);
        return u.min[axis] <= v.max[axis] + gap && v.min[axis] <= u.max[axis] + gap;
      })));
      if (!touching) continue;
      const large = cladingVolume(a) >= cladingVolume(b) ? a : b;
      result[i] = { ...large, boxes: [...a.boxes, ...b.boxes] };
      result.splice(j, 1); again = true; break;
    }
  }
  return result;
}
/** Split union into occupied cells: interior shared faces never receive skin/frame. */
export function cladingFaces(boxes: CladingBox[]): CladingFace[] {
  const coords = Object.fromEntries(axes.map((a) => [a, [...new Set(boxes.flatMap((b) => [b.min[a], b.max[a]]))].sort((a, b) => a - b)])) as Record<"x" | "y" | "z", number[]>;
  const occupied = new Map<string, CladingBox>();
  for (let i = 0; i < coords.x.length - 1; i++) for (let j = 0; j < coords.y.length - 1; j++) for (let k = 0; k < coords.z.length - 1; k++) {
    const x = coords.x[i], X = coords.x[i + 1], y = coords.y[j], Y = coords.y[j + 1], z = coords.z[k], Z = coords.z[k + 1];
    if (x === undefined || X === undefined || y === undefined || Y === undefined || z === undefined || Z === undefined) continue;
    if (boxes.some((b) => x >= b.min.x && X <= b.max.x && y >= b.min.y && Y <= b.max.y && z >= b.min.z && Z <= b.max.z)) occupied.set(`${i},${j},${k}`, { min: { x, y, z }, max: { x: X, y: Y, z: Z } });
  }
  const faces: CladingFace[] = [];
  for (const [key, box] of occupied) {
    const indices = key.split(",").map(Number);
    axes.forEach((axis, index) => {
      for (const sign of [-1, 1] as const) {
        const next = [...indices]; next[index] = (next[index] ?? 0) + sign;
        if (!occupied.has(next.join(","))) faces.push({ box, axis, sign });
      }
    });
  }
  return faces;
}
export function cladingPrisms(items: Clading[], ppm: number, elevation: number): Detail3dPrism[] {
  const prisms: Detail3dPrism[] = [];
  const seen = new Set<string>();
  const emit = (b: CladingBox, kind: "clading" | "cladingFrame") => {
    if (!validBox(b)) return;
    const key = kind + JSON.stringify(b); if (seen.has(key)) return; seen.add(key);
    prisms.push({ kind, outer: [{ x: b.min.x, y: b.min.y }, { x: b.max.x, y: b.min.y }, { x: b.max.x, y: b.max.y }, { x: b.min.x, y: b.max.y }], holes: [], bottom: b.min.z - elevation, top: b.max.z - elevation });
  };
  for (const item of items) {
    const boxes = item.boxes.map((b) => ({ min: { x: b.min.x / ppm, y: b.min.y / ppm, z: b.min.z }, max: { x: b.max.x / ppm, y: b.max.y / ppm, z: b.max.z } }));
    for (const f of cladingFaces(boxes)) {
      const { axis, sign } = f;
      const surface = sign > 0 ? f.box.max[axis] : f.box.min[axis];
      const skin = structuredClone(f.box);
      skin.min[axis] = sign > 0 ? surface - CLADING_SKIN_M : surface;
      skin.max[axis] = sign > 0 ? surface : surface + CLADING_SKIN_M;
      emit(skin, "clading");
      const tangent = axes.filter((a) => a !== axis);
      for (const along of tangent) {
        const across = tangent.find((a) => a !== along); if (!across) continue;
        const lo = f.box.min[across], hi = f.box.max[across];
        const ticks = [lo + 0.02, hi - 0.02];
        for (let t = Math.ceil((lo + 0.04) / CLADING_FRAME_PITCH_M) * CLADING_FRAME_PITCH_M; t < hi - 0.04; t += CLADING_FRAME_PITCH_M) ticks.push(t);
        for (const t of ticks) {
          const tube = structuredClone(f.box);
          tube.min[axis] = sign > 0 ? surface - 0.06 : surface + 0.02;
          tube.max[axis] = sign > 0 ? surface - 0.02 : surface + 0.06;
          tube.min[across] = Math.max(lo, t - 0.02); tube.max[across] = Math.min(hi, t + 0.02);
          // Hollow wall 2 mm, represented by four strips rather than a solid bar.
          for (const side of [axis, across]) for (const end of [-1, 1]) {
            const strip = structuredClone(tube);
            if (end < 0) strip.max[side] = strip.min[side] + 0.002;
            else strip.min[side] = strip.max[side] - 0.002;
            emit(strip, "cladingFrame");
          }
        }
      }
    }
  }
  return prisms;
}
export function extrudeClading(item: Clading, face: CladingFace, distance: number, ppm: number): Clading {
  const box = structuredClone(face.box), a = face.axis, d = distance * (a === "z" ? 1 : ppm);
  const surface = face.sign > 0 ? box.max[a] : box.min[a];
  if (distance > 0) {
    box.min[a] = face.sign > 0 ? surface : surface - d;
    box.max[a] = face.sign > 0 ? surface + d : surface;
    return { ...item, boxes: [...item.boxes, box] };
  }
  box.min[a] = face.sign > 0 ? surface + d : surface;
  box.max[a] = face.sign > 0 ? surface : surface - d;
  const subtract = (b: CladingBox): CladingBox[] => {
    const cut = { min: { x: Math.max(b.min.x, box.min.x), y: Math.max(b.min.y, box.min.y), z: Math.max(b.min.z, box.min.z) }, max: { x: Math.min(b.max.x, box.max.x), y: Math.min(b.max.y, box.max.y), z: Math.min(b.max.z, box.max.z) } };
    if (!validBox(cut)) return [b];
    const remainder: CladingBox[] = [], core = structuredClone(b);
    for (const axis of axes) {
      if (core.min[axis] < cut.min[axis]) { const part = structuredClone(core); part.max[axis] = cut.min[axis]; remainder.push(part); core.min[axis] = cut.min[axis]; }
      if (core.max[axis] > cut.max[axis]) { const part = structuredClone(core); part.min[axis] = cut.max[axis]; remainder.push(part); core.max[axis] = cut.max[axis]; }
    }
    return remainder.filter(validBox);
  };
  return { ...item, boxes: item.boxes.flatMap(subtract) };
}