// Ramp entity: polyline reference + offset to form a sloped slab between two levels.
// All point coordinates are in world pixels (same convention as Line/Floor in sketch.tsx).

export type Point = { x: number; y: number };

export type RampAnchor = Point & { filletR?: number /* meters */ };

export type Ramp = {
  id: string;
  levelId: string;            // level penggambaran (kaki ramp)
  anchors: RampAnchor[];      // polyline acuan (sisi 1)
  offsetSide: "left" | "right"; // sisi offset 1m relatif arah polyline
  widthM: number;             // lebar ramp (m), default 1
  nM: number;                 // panjang acuan kemiringan (m), default 7
  lockedLenM?: number;        // panjang polyline acuan yang dikunci setelah penerapan kemiringan (m)
  bordes?: boolean;           // jika true, sisipkan bordes setiap `bordesSpacingM` di sepanjang slope
  bordesLenM?: number;        // panjang tiap bordes (m), default 1.2
  bordesSpacingM?: number;    // jarak slope antar bordes (m), default 9
  bordesBelokan?: boolean;    // jika true, tambahkan bordes persegi di tiap sudut belokan
  createdAt: number;
};


export function genRampId(): string {
  return `ramp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeRamp(levelId: string, anchors: Point[], opts?: Partial<Ramp>): Ramp {
  return {
    id: genRampId(),
    levelId,
    anchors: anchors.map((p) => ({ x: p.x, y: p.y })),
    offsetSide: opts?.offsetSide ?? "right",
    widthM: opts?.widthM ?? 1,
    nM: opts?.nM ?? 7,
    createdAt: Date.now(),
  };
}

// ---------- geometry helpers ----------

function len(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polylineLength(pts: Point[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += len(pts[i - 1], pts[i]);
  return L;
}

export function pointAtArcLength(pts: Point[], s: number): { p: Point; t: Point } {
  // t = unit tangent
  if (pts.length < 2) return { p: pts[0] ?? { x: 0, y: 0 }, t: { x: 1, y: 0 } };
  let remain = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = len(a, b);
    if (d <= 1e-9) continue;
    if (remain <= d) {
      const u = remain / d;
      const tx = (b.x - a.x) / d, ty = (b.y - a.y) / d;
      return { p: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, t: { x: tx, y: ty } };
    }
    remain -= d;
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const d = Math.max(1e-9, len(a, b));
  return { p: { x: b.x, y: b.y }, t: { x: (b.x - a.x) / d, y: (b.y - a.y) / d } };
}

// Tessellate the reference polyline, replacing each internal corner that has filletR>0
// with a tangent arc of that radius. Returns a dense polyline (px).
export function tessellateReference(anchors: RampAnchor[], pxPerMeter: number, arcSeg = 18): Point[] {
  if (anchors.length < 2) return anchors.map((p) => ({ x: p.x, y: p.y }));
  const out: Point[] = [{ x: anchors[0].x, y: anchors[0].y }];
  for (let i = 1; i < anchors.length - 1; i++) {
    const A = anchors[i - 1], B = anchors[i], C = anchors[i + 1];
    const r = ((B.filletR ?? 0) > 0 ? (B.filletR as number) : 0) * pxPerMeter;
    const vAB = { x: B.x - A.x, y: B.y - A.y };
    const vBC = { x: C.x - B.x, y: C.y - B.y };
    const lAB = Math.hypot(vAB.x, vAB.y), lBC = Math.hypot(vBC.x, vBC.y);
    if (r <= 0 || lAB < 1e-6 || lBC < 1e-6) {
      out.push({ x: B.x, y: B.y });
      continue;
    }
    const uAB = { x: vAB.x / lAB, y: vAB.y / lAB };
    const uBC = { x: vBC.x / lBC, y: vBC.y / lBC };
    // half angle between incoming reversed and outgoing
    const dot = -uAB.x * uBC.x + -uAB.y * uBC.y; // = cos(theta) where theta is interior between -uAB and uBC
    const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (theta < 1e-3 || Math.PI - theta < 1e-3) { out.push({ x: B.x, y: B.y }); continue; }
    const halfTheta = theta / 2;
    const tanLen = r / Math.tan(halfTheta);
    const maxTan = Math.min(lAB, lBC) * 0.49;
    const t = Math.min(tanLen, maxTan);
    const eff = t * Math.tan(halfTheta);
    // tangent points
    const T1 = { x: B.x - uAB.x * t, y: B.y - uAB.y * t };
    const T2 = { x: B.x + uBC.x * t, y: B.y + uBC.y * t };
    // center: perpendicular to uAB at T1, side determined by turn direction
    const cross = uAB.x * uBC.y - uAB.y * uBC.x;
    const sign = cross >= 0 ? 1 : -1;
    const n1 = { x: -uAB.y * sign, y: uAB.x * sign };
    const center = { x: T1.x + n1.x * eff, y: T1.y + n1.y * eff };
    const a0 = Math.atan2(T1.y - center.y, T1.x - center.x);
    const a1 = Math.atan2(T2.y - center.y, T2.x - center.x);
    let da = a1 - a0;
    if (sign > 0) { while (da < 0) da += 2 * Math.PI; } else { while (da > 0) da -= 2 * Math.PI; }
    out.push(T1);
    const N = Math.max(4, Math.round(arcSeg * (Math.abs(da) / Math.PI)));
    for (let k = 1; k < N; k++) {
      const a = a0 + (da * k) / N;
      out.push({ x: center.x + eff * Math.cos(a), y: center.y + eff * Math.sin(a) });
    }
    out.push(T2);
  }
  out.push({ x: anchors[anchors.length - 1].x, y: anchors[anchors.length - 1].y });
  return out;
}

// Offset a dense polyline by w (px) to the given side. Uses miter-limited joints.
export function offsetPolyline(pts: Point[], wPx: number, side: "left" | "right"): Point[] {
  if (pts.length < 2) return pts.slice();
  const sgn = side === "right" ? 1 : -1;
  const segNormals: Point[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const L = Math.max(1e-9, Math.hypot(dx, dy));
    // right normal: (dy/L, -dx/L)
    segNormals.push({ x: (dy / L) * sgn, y: (-dx / L) * sgn });
  }
  const out: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    let n: Point;
    if (i === 0) n = segNormals[0];
    else if (i === pts.length - 1) n = segNormals[segNormals.length - 1];
    else {
      const a = segNormals[i - 1], b = segNormals[i];
      const bx = a.x + b.x, by = a.y + b.y;
      const L = Math.hypot(bx, by);
      if (L < 1e-6) { n = a; }
      else {
        // Diagonal sudut ramp dibuat tetap = w * sqrt(2) (sisi miring segitiga
        // siku-siku dengan kedua sisi = lebar ramp), tidak bergantung sudut belokan.
        // Caranya: arahkan offset sepanjang bisector unit, lalu skala = sqrt(2).
        const ux = bx / L, uy = by / L; // unit bisector
        const scale = Math.SQRT2;
        n = { x: ux * scale, y: uy * scale };
      }
    }
    out.push({ x: pts[i].x + n.x * wPx, y: pts[i].y + n.y * wPx });
  }
  return out;
}

// Build closed boundary polygon (anchor side -> offset side reversed)
export function rampBoundary(refDense: Point[], offDense: Point[]): Point[] {
  return [...refDense, ...offDense.slice().reverse()];
}

// ---------- bordes helpers ----------

// Hitung posisi bordes (sebagai range arc-length dalam METER pada centerline)
// `centerlineLenM` adalah total panjang centerline (slope + bordes) dalam meter.
// `slopeLenM` adalah komponen miring saja (= t * n).
export function computeBordesArcs(
  centerlineLenM: number,
  slopeLenM: number,
  spacingM: number,
  bordesLenM: number,
  hasBordes: boolean,
): Array<{ s0: number; s1: number }> {
  if (!hasBordes || spacingM <= 0 || bordesLenM <= 0 || slopeLenM <= 0) return [];
  const out: Array<{ s0: number; s1: number }> = [];
  const numBordes = Math.max(0, Math.floor((slopeLenM - 1e-3) / spacingM));
  for (let k = 1; k <= numBordes; k++) {
    const s0 = k * spacingM + (k - 1) * bordesLenM;
    const s1 = s0 + bordesLenM;
    if (s0 >= centerlineLenM - 1e-3) break;
    out.push({ s0, s1: Math.min(s1, centerlineLenM) });
  }
  return out;
}

export function numBordesForSlope(slopeLenM: number, spacingM: number): number {
  if (slopeLenM <= 0 || spacingM <= 0) return 0;
  return Math.max(0, Math.floor((slopeLenM - 1e-3) / spacingM));
}
