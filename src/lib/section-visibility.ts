import { detail3dBottomAt, type Detail3dPrism } from "./level-detail-3d";
import { sectionCoords, type Section3dFrame } from "./section-3d";

type Vertex = { s: number; h: number; d: number };
export type SectionVisibleLine = { a: { s: number; h: number }; b: { s: number; h: number } };
type Shield = { a: Vertex; b: Vertex; top: number };
const EPS = 1e-6;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Exact orthographic visibility: split edges at projected boundaries and depth crossings.
 * Transparent glazing is not an occluder; solid side surfaces hide rear edges, including
 * their own back edges. Openings remain open because the model already cuts wall prisms. */
export function sectionVisibleLines(prisms: Detail3dPrism[], frame: Section3dFrame): SectionVisibleLine[] {
  const edges: Array<{ a: Vertex; b: Vertex }> = [];
  const shields: Shield[] = [];
  for (const prism of prisms) for (const ring of [prism.outer, ...prism.holes]) {
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      if (!q) return;
      const a = { ...sectionCoords(frame, p), h: detail3dBottomAt(prism, p) };
      const b = { ...sectionCoords(frame, q), h: detail3dBottomAt(prism, q) };
      edges.push({ a, b }, { a: { ...a, h: prism.top }, b: { ...b, h: prism.top } }, { a, b: { ...a, h: prism.top } });
      if (prism.kind !== "glass" && Math.abs(a.s - b.s) > EPS) shields.push(a.s < b.s ? { a, b, top: prism.top } : { a: b, b: a, top: prism.top });
    });
  }
  const visible: SectionVisibleLine[] = [];
  for (const edge of edges) {
    if (Math.hypot(edge.a.s - edge.b.s, edge.a.h - edge.b.h) < EPS) continue;
    const breaks = [0, 1];
    const relevant = shields.filter(shield => shield.b.s >= Math.min(edge.a.s, edge.b.s) - EPS && shield.a.s <= Math.max(edge.a.s, edge.b.s) + EPS && shield.top >= Math.min(edge.a.h, edge.b.h) - EPS);
    const at = (t: number): Vertex => ({ s: lerp(edge.a.s, edge.b.s, t), h: lerp(edge.a.h, edge.b.h, t), d: lerp(edge.a.d, edge.b.d, t) });
    const shieldAt = (shield: Shield, s: number) => {
      const t = (s - shield.a.s) / (shield.b.s - shield.a.s);
      return { h: lerp(shield.a.h, shield.b.h, t), d: lerp(shield.a.d, shield.b.d, t) };
    };
    const root = (v0: number, v1: number) => {
      if (Math.abs(v1 - v0) < EPS) return;
      const t = -v0 / (v1 - v0);
      if (t > EPS && t < 1 - EPS) breaks.push(t);
    };
    for (const shield of relevant) {
      root(edge.a.s - shield.a.s, edge.b.s - shield.a.s);
      root(edge.a.s - shield.b.s, edge.b.s - shield.b.s);
      root(edge.a.h - shield.top, edge.b.h - shield.top);
      const a = shieldAt(shield, edge.a.s), b = shieldAt(shield, edge.b.s);
      root(edge.a.h - a.h, edge.b.h - b.h);
      root(edge.a.d - a.d, edge.b.d - b.d);
    }
    const sorted = breaks.sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - (all[i - 1] ?? 0) > EPS);
    for (let i = 0; i < sorted.length - 1; i++) {
      const t0 = sorted[i], t1 = sorted[i + 1];
      if (t0 === undefined || t1 === undefined) continue;
      const mid = at((t0 + t1) / 2);
      const hidden = relevant.some(shield => {
        if (mid.s < shield.a.s - EPS || mid.s > shield.b.s + EPS) return false;
        const front = shieldAt(shield, mid.s);
        return mid.h >= front.h - EPS && mid.h <= shield.top + EPS && mid.d > front.d + EPS;
      });
      if (!hidden) visible.push({ a: at(t0), b: at(t1) });
    }
  }
  // Merge collinear overlapping segments, so shared slab/wall/frame edges draw once.
  const groups = new Map<string, { u: { s: number; h: number }; offset: number; spans: Array<[number, number]> }>();
  const round = (n: number) => Math.round(n / EPS) * EPS;
  for (const line of visible) {
    const ds = line.b.s - line.a.s, dh = line.b.h - line.a.h, length = Math.hypot(ds, dh);
    if (length < EPS) continue;
    const sign = ds < -EPS || (Math.abs(ds) < EPS && dh < 0) ? -1 : 1;
    const u = { s: ds / length * sign, h: dh / length * sign };
    const offset = -u.h * line.a.s + u.s * line.a.h;
    const key = `${round(u.s)},${round(u.h)},${round(offset)}`;
    const group = groups.get(key) ?? { u, offset, spans: [] };
    const a = u.s * line.a.s + u.h * line.a.h, b = u.s * line.b.s + u.h * line.b.h;
    group.spans.push([Math.min(a, b), Math.max(a, b)]);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap(({ u, offset, spans }) => {
    const merged: Array<[number, number]> = [];
    for (const span of spans.sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[1] + EPS) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    const point = (t: number) => ({ s: u.s * t - u.h * offset, h: u.h * t + u.s * offset });
    return merged.map(([a, b]) => ({ a: point(a), b: point(b) }));
  });
}