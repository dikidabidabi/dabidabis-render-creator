import { boxOutline, outlineBox, validOutline, type CladingPoint } from "./clading-solid";
import { moveClading, type Clading } from "./clading";
import { polygonCladingPrisms } from "./clading-prisms";

export type CladingPointRef = { id: string; boxIndex: number; index: number };

/** Moves several outline points at once; a box whose result is invalid keeps its old shape. */
export function moveCladingPoints(
  items: Clading[],
  refs: CladingPointRef[],
  dx: number,
  dy: number,
): Clading[] {
  return items.map((item) => {
    const mine = refs.filter((r) => r.id === item.id);
    if (!mine.length) return item;
    return {
      ...item,
      boxes: item.boxes.map((b, boxIndex) => {
        const picked = new Set(mine.filter((r) => r.boxIndex === boxIndex).map((r) => r.index));
        if (!picked.size) return b;
        const points = boxOutline(b).map((p, i) => (picked.has(i) ? { x: p.x + dx, y: p.y + dy } : p));
        return validOutline(points) ? outlineBox(points, b.min.z, b.max.z) : b;
      }),
    };
  });
}

/** Translation between two shapes, or null when b is not just a moved copy of a. */
export function cladingShapeDelta(a: Clading, b: Clading): { x: number; y: number; z: number } | null {
  if (a.boxes.length !== b.boxes.length) return null;
  const A0 = a.boxes[0],
    B0 = b.boxes[0];
  if (!A0 || !B0) return null;
  const d = { x: B0.min.x - A0.min.x, y: B0.min.y - A0.min.y, z: B0.min.z - A0.min.z };
  const eps = 1e-6;
  for (let i = 0; i < a.boxes.length; i++) {
    const u = a.boxes[i]!,
      v = b.boxes[i]!;
    const P = boxOutline(u),
      Q = boxOutline(v);
    if (P.length !== Q.length) return null;
    if (Math.abs(v.min.z - u.min.z - d.z) > eps || Math.abs(v.max.z - u.max.z - d.z) > eps) return null;
    for (let k = 0; k < P.length; k++)
      if (Math.abs(Q[k]!.x - P[k]!.x - d.x) > eps || Math.abs(Q[k]!.y - P[k]!.y - d.y) > eps)
        return null;
  }
  return d;
}

/**
 * Propagates shape edits of linked instances. An item whose new shape is only a
 * translation of its previous shape counts as moved and leaves its siblings alone.
 */
export function syncCladingInstances(prev: Clading[], next: Clading[]): Clading[] {
  const before = new Map(prev.map((c) => [c.id, c]));
  const result = [...next];
  const done = new Set<string>();
  for (const edited of next) {
    if (!edited.linkId || done.has(edited.linkId)) continue;
    const old = before.get(edited.id);
    if (!old || old === edited || cladingShapeDelta(old, edited)) continue;
    done.add(edited.linkId);
    result.forEach((sib, i) => {
      if (sib.id === edited.id || sib.linkId !== edited.linkId) return;
      const ref = before.get(sib.id) ?? sib;
      const A0 = old.boxes[0],
        B0 = ref.boxes[0];
      if (!A0 || !B0) return;
      const moved = moveClading(edited, B0.min.x - A0.min.x, B0.min.y - A0.min.y, B0.min.z - A0.min.z);
      result[i] = { ...sib, boxes: moved.boxes };
    });
  }
  return result;
}

export type CladingClipboard = { items: Clading[]; linked: boolean };

/**
 * Pastes copies on a level. Copies are independent; instances share a linkId with
 * their source (sources without one receive their own id as linkId).
 * Pasting on the source level shifts by the copy's width plus 0.5 m.
 */
export function pasteClading(
  all: Clading[],
  clip: CladingClipboard,
  levelId: string,
  ppm: number,
  makeId: () => string,
): Clading[] {
  let result = [...all];
  const xs = clip.items.flatMap((c) => c.boxes.flatMap((b) => [b.min.x, b.max.x]));
  const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const shift = clip.items.some((c) => c.levelId === levelId) ? width + 0.5 * ppm : 0;
  for (const src of clip.items) {
    const linkId = clip.linked ? (src.linkId ?? src.id) : undefined;
    if (linkId && !src.linkId) result = result.map((c) => (c.id === src.id ? { ...c, linkId } : c));
    const moved = moveClading(src, shift, 0, 0);
    const copy: Clading = {
      id: makeId(),
      name: `${src.name} ${clip.linked ? "(instance)" : "(salinan)"}`,
      levelId,
      boxes: moved.boxes,
    };
    result.push(linkId ? { ...copy, linkId } : copy);
  }
  return result;
}

export type CladingPlanCut = {
  skin: CladingPoint[][];
  frame: CladingPoint[][];
  below: CladingPoint[][];
  above: CladingPoint[][];
};

/** Horizontal cut of skin and hollow frame at `cut` m above the level, rings in sketch px. */
export function cladingPlanCut(items: Clading[], ppm: number, cut = 1): CladingPlanCut {
  const out: CladingPlanCut = { skin: [], frame: [], below: [], above: [] };
  const toPx = (r: CladingPoint[]) => r.map((p) => ({ x: p.x * ppm, y: p.y * ppm }));
  for (const item of items) {
    const bottom = Math.min(...item.boxes.map((b) => b.min.z)),
      top = Math.max(...item.boxes.map((b) => b.max.z));
    if (bottom > cut || top <= cut) {
      for (const b of item.boxes) (bottom > cut ? out.above : out.below).push(boxOutline(b));
      continue;
    }
    for (const p of polygonCladingPrisms([item], ppm, 0)) {
      if (!(p.bottom <= cut && p.top > cut)) continue;
      (p.kind === "cladingFrame" ? out.frame : out.skin).push(toPx(p.outer));
    }
    for (const b of item.boxes) if (b.min.z > cut) out.above.push(boxOutline(b));
  }
  return out;
}
