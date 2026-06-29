// Roads — jalan dengan lebar + fillet untuk halaman Master Plan.
// Disimpan di sketch.roads. Disimulasikan sebagai garis (2 titik) atau
// tangent spline (≥3 titik), di-offset ±width/2 untuk menghasilkan tepi
// kiri/kanan; sudut belokan dibulatkan oleh fillet (radius meter).
//
// Cluster Generator memakai:
// - corridorPolygon → "no-build" zone
// - nearestRoadEdge → gravitasi & orientasi bangunan
// - roadNetworkRegions(site, roads) → membagi Lahan menjadi kluster

import { sampleTangent, type Vec2 } from "@/lib/axes";
import polygonClipping from "polygon-clipping";

/** Union sekumpulan polygon koridor dan fillet semua sudut ring hasil.
 *  Input `corridors` adalah polygon tertutup (CCW/CW bebas) dalam unit yang sama
 *  dengan `filletRadius`. Keluaran berupa rings (outer + holes) dalam unit
 *  yang sama dengan input — caller bebas mengonversinya ke meter/pixel/dst.
 */
export function unionFilletedCorridors(
  corridors: Vec2[][],
  filletRadius: number,
): { outer: Vec2[]; holes: Vec2[][] }[] {
  const valid = corridors.filter((c) => c.length >= 3);
  if (valid.length === 0) return [];
  type Ring = Vec2[];
  let unionRings: { outer: Ring; holes: Ring[] }[] = [];
  try {
    const polys = valid.map((c) => [c.map((p) => [p.x, p.y] as [number, number])]);
    const u = polygonClipping.union(polys[0] as any, ...(polys.slice(1) as any[]));
    unionRings = u.map((poly) => ({
      outer: poly[0].map(([x, y]) => ({ x, y })),
      holes: poly.slice(1).map((h) => h.map(([x, y]) => ({ x, y }))),
    }));
  } catch {
    unionRings = valid.map((c) => ({ outer: c.slice(), holes: [] }));
  }
  const dedup = (r: Ring): Ring => {
    if (r.length < 2) return r;
    const last = r[r.length - 1], first = r[0];
    if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-6) return r.slice(0, -1);
    return r;
  };
  const ARC_STEPS = 10;
  const filletRing = (ring: Ring): Ring => {
    const n = ring.length;
    if (n < 3 || filletRadius <= 0) return ring.slice();
    const out: Ring = [];
    for (let i = 0; i < n; i++) {
      const prev = ring[(i + n - 1) % n];
      const cur = ring[i];
      const next = ring[(i + 1) % n];
      const v1x = prev.x - cur.x, v1y = prev.y - cur.y;
      const v2x = next.x - cur.x, v2y = next.y - cur.y;
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (l1 < 1e-4 || l2 < 1e-4) { out.push(cur); continue; }
      const u1x = v1x / l1, u1y = v1y / l1;
      const u2x = v2x / l2, u2y = v2y / l2;
      const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
      const theta = Math.acos(dot);
      if (theta > Math.PI - 0.06 || theta < 0.06) { out.push(cur); continue; }
      const half = theta / 2;
      const tanH = Math.tan(half);
      let d = filletRadius / tanH;
      d = Math.min(d, l1 * 0.5, l2 * 0.5);
      const r = d * tanH;
      const t1 = { x: cur.x + u1x * d, y: cur.y + u1y * d };
      const t2 = { x: cur.x + u2x * d, y: cur.y + u2y * d };
      const bx = u1x + u2x, by = u1y + u2y;
      const bl = Math.hypot(bx, by) || 1;
      const cdist = r / Math.sin(half);
      const cc = { x: cur.x + (bx / bl) * cdist, y: cur.y + (by / bl) * cdist };
      let a1 = Math.atan2(t1.y - cc.y, t1.x - cc.x);
      const a2 = Math.atan2(t2.y - cc.y, t2.x - cc.x);
      let da = a2 - a1;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      out.push(t1);
      for (let k = 1; k < ARC_STEPS; k++) {
        const a = a1 + (da * k) / ARC_STEPS;
        out.push({ x: cc.x + Math.cos(a) * r, y: cc.y + Math.sin(a) * r });
      }
      out.push(t2);
    }
    return out;
  };
  return unionRings.map(({ outer, holes }) => ({
    outer: filletRing(dedup(outer)),
    holes: holes.map((h) => filletRing(dedup(h))),
  }));
}


export type RoadKind = "garis" | "tangent";

export type RoadSegment = {
  id: string;
  kind: RoadKind;
  /** Kontrol point dalam koordinat WORLD-PIXEL (sama seperti aksis/layer). */
  points: Vec2[];
  /** Lebar koridor jalan dalam METER. */
  widthM: number;
  /** Radius fillet sudut dalam METER (0 = tidak ada). */
  filletM: number;
  createdAt: number;
};

export function newRoadId(): string {
  return `rd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Polyline centerline tersampling (px atau m — apa pun unit input points). */
export function roadCenterline(r: RoadSegment): Vec2[] {
  if (r.kind === "tangent" && r.points.length >= 3) return sampleTangent(r.points, 18);
  return r.points.slice();
}

function normal(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: -dy / l, y: dx / l };
}

/** Offset polyline by signed distance (positive = left of travel). Miter-limited. */
export function offsetPolyline(poly: Vec2[], offset: number): Vec2[] {
  if (poly.length < 2) return poly.slice();
  const out: Vec2[] = [];
  const segNormals: Vec2[] = [];
  for (let i = 0; i < poly.length - 1; i++) segNormals.push(normal(poly[i], poly[i + 1]));
  out.push({ x: poly[0].x + segNormals[0].x * offset, y: poly[0].y + segNormals[0].y * offset });
  for (let i = 1; i < poly.length - 1; i++) {
    const n1 = segNormals[i - 1];
    const n2 = segNormals[i];
    const bx = n1.x + n2.x, by = n1.y + n2.y;
    const bl = Math.hypot(bx, by) || 1;
    const dot = (n1.x * n2.x + n1.y * n2.y);
    const miter = Math.min(4, 1 / Math.max(0.25, (1 + dot) / 2));
    out.push({
      x: poly[i].x + (bx / bl) * offset * miter,
      y: poly[i].y + (by / bl) * offset * miter,
    });
  }
  const last = segNormals[segNormals.length - 1];
  const lp = poly[poly.length - 1];
  out.push({ x: lp.x + last.x * offset, y: lp.y + last.y * offset });
  return out;
}

/** Polygon koridor jalan (kiri ∪ kanan, tertutup). pxPerMeter untuk konversi widthM → unit poly. */
export function roadCorridorPolygon(r: RoadSegment, pxPerMeter: number): Vec2[] {
  const c = roadCenterline(r);
  if (c.length < 2) return [];
  const halfPx = (r.widthM * pxPerMeter) / 2;
  const left = offsetPolyline(c, halfPx);
  const right = offsetPolyline(c, -halfPx);
  return [...left, ...right.slice().reverse()];
}

/** Centerline + edges sudah dalam METER (caller menyiapkan unit). */
export function roadEdgesMeters(r: RoadSegment, pxPerMeter: number): { left: Vec2[]; right: Vec2[]; center: Vec2[] } {
  const c = roadCenterline(r).map((p) => ({ x: p.x / pxPerMeter, y: p.y / pxPerMeter }));
  const half = r.widthM / 2;
  return { left: offsetPolyline(c, half), right: offsetPolyline(c, -half), center: c };
}

function pointSegDist(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-9 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return { d: Math.hypot(p.x - cx, p.y - cy), t, cx, cy, tx: dx, ty: dy };
}

/** Untuk titik p (meter), cari titik terdekat pada salah satu edge jalan.
 *  Mengembalikan edge terdekat + tangent (unit) + normal (mengarah keluar koridor). */
export function nearestRoadEdge(
  p: Vec2,
  roads: { center: Vec2[]; widthM: number }[],
): { d: number; pt: Vec2; tan: Vec2; nor: Vec2 } | null {
  let best: { d: number; pt: Vec2; tan: Vec2; nor: Vec2 } | null = null;
  for (const r of roads) {
    const half = r.widthM / 2;
    if (r.center.length < 2) continue;
    // dist to centerline
    let bestC = { d: Infinity, cx: 0, cy: 0, tx: 1, ty: 0 };
    for (let i = 0; i < r.center.length - 1; i++) {
      const s = pointSegDist(p, r.center[i], r.center[i + 1]);
      if (s.d < bestC.d) bestC = { d: s.d, cx: s.cx, cy: s.cy, tx: s.tx, ty: s.ty };
    }
    const tl = Math.hypot(bestC.tx, bestC.ty) || 1;
    const tan: Vec2 = { x: bestC.tx / tl, y: bestC.ty / tl };
    // normal arah keluar koridor (menjauh dari centerline)
    const ox = p.x - bestC.cx, oy = p.y - bestC.cy;
    const ol = Math.hypot(ox, oy) || 1;
    const nor: Vec2 = { x: ox / ol, y: oy / ol };
    const distToEdge = Math.max(0, bestC.d - half);
    // titik tepi (proyeksi dari center ke arah p, sejauh half)
    const pt: Vec2 = { x: bestC.cx + nor.x * half, y: bestC.cy + nor.y * half };
    if (!best || distToEdge < best.d) best = { d: distToEdge, pt, tan, nor };
  }
  return best;
}

/** Titik p ada di dalam koridor jalan (meter). */
export function pointInRoadCorridor(p: Vec2, roads: { center: Vec2[]; widthM: number }[]): boolean {
  for (const r of roads) {
    const half = r.widthM / 2;
    for (let i = 0; i < r.center.length - 1; i++) {
      const s = pointSegDist(p, r.center[i], r.center[i + 1]);
      if (s.d <= half) return true;
    }
  }
  return false;
}

/* -------------------- Region partition -------------------- */
// Bagi polygon `poly` dengan garis tak-hingga lewat (a, b).
function splitPolygonByInfiniteLine(poly: Vec2[], a: Vec2, b: Vec2): [Vec2[], Vec2[]] | null {
  if (poly.length < 3) return null;
  const nx = -(b.y - a.y), ny = b.x - a.x;
  const side = (p: Vec2) => (p.x - a.x) * nx + (p.y - a.y) * ny;
  const left: Vec2[] = [], right: Vec2[] = [];
  let cuts = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    const s1 = side(p1), s2 = side(p2);
    if (s1 >= 0) left.push(p1);
    if (s1 <= 0) right.push(p1);
    if ((s1 > 0 && s2 < 0) || (s1 < 0 && s2 > 0)) {
      const t = s1 / (s1 - s2);
      const ix = { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
      left.push(ix); right.push(ix); cuts++;
    }
  }
  if (cuts < 2 || left.length < 3 || right.length < 3) return null;
  return [left, right];
}

function polyAreaAbs(poly: Vec2[]): number {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function polyCentroidLocal(poly: Vec2[]): Vec2 {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  return { x: cx / poly.length, y: cy / poly.length };
}

/** Bagi `sitePoly` (meter) oleh setiap segmen centerline jalan menjadi region.
 *  Region yang tersisa adalah kandidat kluster bangunan. */
export function roadNetworkRegions(
  sitePoly: Vec2[],
  roads: { center: Vec2[]; widthM: number }[],
  minAreaM2 = 80,
): { polygon: Vec2[]; centroid: Vec2; area: number }[] {
  let regions: Vec2[][] = [sitePoly.slice()];
  for (const r of roads) {
    for (let i = 0; i < r.center.length - 1; i++) {
      const a = r.center[i], b = r.center[i + 1];
      const next: Vec2[][] = [];
      for (const poly of regions) {
        const split = splitPolygonByInfiniteLine(poly, a, b);
        if (!split) { next.push(poly); continue; }
        next.push(split[0], split[1]);
      }
      regions = next;
    }
  }
  // Buang region yang centroidnya berada di dalam koridor jalan, dan yang terlalu kecil.
  const out: { polygon: Vec2[]; centroid: Vec2; area: number }[] = [];
  for (const poly of regions) {
    const area = polyAreaAbs(poly);
    if (area < minAreaM2) continue;
    const c = polyCentroidLocal(poly);
    if (pointInRoadCorridor(c, roads)) continue;
    out.push({ polygon: poly, centroid: c, area });
  }
  return out;
}
