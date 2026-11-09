// Geometri dinding untuk garis lengkung (arc) dan tangent (bezier) yang diberi
// material melalui Pick Material. Dipakai slide Denah/Detail agar dinding
// lengkung tampil dengan notasi material yang sama seperti dinding lurus.

export type CurvePoint = { x: number; y: number };
export type CurveLine = {
  a: CurvePoint;
  b: CurvePoint;
  kind?: "straight" | "arc" | "bezier";
  bulge?: number;
  c1?: CurvePoint;
  c2?: CurvePoint;
};

export const CURVE_WALL_STEPS = 48;

/** Titik-titik sampel sepanjang garis lengkung, termasuk kedua ujung. */
export function sampleCurveLine(ln: CurveLine, steps = CURVE_WALL_STEPS): CurvePoint[] {
  const kind = ln.kind ?? "straight";
  if (kind === "straight") return [ln.a, ln.b];
  const dx = ln.b.x - ln.a.x, dy = ln.b.y - ln.a.y;
  const length = Math.hypot(dx, dy) || 1;
  const bulge = ln.bulge ?? 0;
  const control = {
    x: (ln.a.x + ln.b.x) / 2 - (2 * dy / length) * bulge,
    y: (ln.a.y + ln.b.y) / 2 + (2 * dx / length) * bulge,
  };
  const c1 = ln.c1 ?? ln.a, c2 = ln.c2 ?? ln.b;
  const points: CurvePoint[] = [ln.a];
  for (let i = 1; i < steps; i++) {
    const t = i / steps, u = 1 - t;
    points.push(kind === "arc"
      ? { x: u * u * ln.a.x + 2 * u * t * control.x + t * t * ln.b.x, y: u * u * ln.a.y + 2 * u * t * control.y + t * t * ln.b.y }
      : {
        x: u ** 3 * ln.a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * ln.b.x,
        y: u ** 3 * ln.a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * ln.b.y,
      });
  }
  points.push(ln.b);
  // Buang titik kembar agar normal tidak NaN.
  return points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1e-9);
}

function unit(a: CurvePoint, b: CurvePoint): CurvePoint {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

/** Arah keluar dari tiap ujung polyline (dari ujung menuju bagian dalam garis). */
export function curveEndDirections(points: CurvePoint[]): { start: CurvePoint; end: CurvePoint } | null {
  if (points.length < 2) return null;
  return { start: unit(points[0], points[1]), end: unit(points[points.length - 1], points[points.length - 2]) };
}

/** Poligon pita dinding selebar 2 × half mengikuti polyline lengkung, dengan
 *  sambungan miter dan perpanjangan ujung agar menutup pertemuan dinding. */
export function curveWallBand(points: CurvePoint[], half: number, endExtension = half): CurvePoint[] {
  if (points.length < 2 || !(half > 0)) return [];
  const directions = points.slice(1).map((point, index) => unit(points[index], point));
  const left: CurvePoint[] = [];
  const right: CurvePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const before = directions[Math.max(0, i - 1)];
    const after = directions[Math.min(directions.length - 1, i)];
    let tx = before.x + after.x, ty = before.y + after.y;
    const tLength = Math.hypot(tx, ty);
    if (tLength < 1e-9) { tx = after.x; ty = after.y; } else { tx /= tLength; ty /= tLength; }
    const normal = { x: -ty, y: tx };
    const cos = Math.max(0.25, normal.x * -after.y + normal.y * after.x);
    const offset = half / cos;
    let base = points[i];
    if (i === 0) base = { x: base.x - after.x * endExtension, y: base.y - after.y * endExtension };
    if (i === points.length - 1) base = { x: base.x + before.x * endExtension, y: base.y + before.y * endExtension };
    left.push({ x: base.x + normal.x * offset, y: base.y + normal.y * offset });
    right.push({ x: base.x - normal.x * offset, y: base.y - normal.y * offset });
  }
  return [...left, ...right.reverse()];
}
