// Axes — sumbu rancangan (garis & tangent) untuk halaman Master Plan.
// Disimpan di sketch.axes; berfungsi sebagai garis yang harus DIHINDARI
// oleh Cluster Generator saat menata massa di dalam Lahan.

export type Vec2 = { x: number; y: number };

export type AxisKind = "garis" | "tangent";

export type AxisSegment = {
  id: string;
  kind: AxisKind;
  /** Kontrol point dalam koordinat WORLD-PIXEL (sama seperti layer/lines). */
  points: Vec2[];
  /** Buffer hindar dalam METER (jarak minimum massa dari aksis). */
  bufferM: number;
  createdAt: number;
};

export function newAxisId(): string {
  return `ax_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Catmull-Rom (centripetal-ish, alpha=0.5 dampened) → polyline halus.
 *  Input: kontrol point >= 2. Mengembalikan polyline tersampling. */
export function sampleTangent(ctrl: Vec2[], samplesPerSegment = 18): Vec2[] {
  if (ctrl.length < 2) return ctrl.slice();
  if (ctrl.length === 2) return ctrl.slice();
  const pts: Vec2[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[i === 0 ? 0 : i - 1];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[i + 2 >= n ? n - 1 : i + 2];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        ((2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        ((2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      pts.push({ x, y });
    }
  }
  pts.push(ctrl[n - 1]);
  return pts;
}

/** Polyline (≥2 titik) untuk axis dalam koordinat apa pun (px atau m). */
export function axisPolyline(a: AxisSegment): Vec2[] {
  if (a.kind === "tangent" && a.points.length >= 3) return sampleTangent(a.points, 18);
  return a.points.slice();
}

function distPointToSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; nx: number; ny: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-9 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx;
  const ey = p.y - cy;
  const d = Math.hypot(ex, ey);
  return { d, nx: d > 1e-6 ? ex / d : 0, ny: d > 1e-6 ? ey / d : 0 };
}

/** Repulsion dari sebuah polyline aksis (dalam koordinat meter): titik p
 *  didorong menjauh dari titik terdekat di polyline jika dalam radius buffer.
 *  Mengembalikan komponen gaya (fx, fy). */
export function axisRepulsion(
  p: Vec2,
  polyM: Vec2[],
  bufferM: number,
  strength = 0.18,
): { fx: number; fy: number } {
  if (polyM.length < 2 || bufferM <= 0) return { fx: 0, fy: 0 };
  let best = { d: Infinity, nx: 0, ny: 0 };
  for (let i = 0; i < polyM.length - 1; i++) {
    const r = distPointToSegment(p, polyM[i], polyM[i + 1]);
    if (r.d < best.d) best = r;
  }
  if (best.d >= bufferM) return { fx: 0, fy: 0 };
  const k = (bufferM - best.d) * strength;
  return { fx: best.nx * k, fy: best.ny * k };
}
