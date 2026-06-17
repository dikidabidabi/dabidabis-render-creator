// Minimal DXF (R12 ASCII) writer untuk mengekspor sketsa denah ke CAD.
// Unit DXF = METER (real-world / true scale 1:1). Sumbu Y di-flip dari kanvas
// (Y kanvas turun → Y CAD naik) supaya orientasi sesuai konvensi CAD.

import type { ParkingArea, ParkingStall } from "@/lib/parking";

export type DxfPoint = { x: number; y: number };

export type DxfLine = {
  a: DxfPoint;
  b: DxfPoint;
  kind?: "straight" | "arc" | "bezier";
  bulge?: number;
  c1?: DxfPoint;
  c2?: DxfPoint;
};

export type DxfLayerPoly = {
  name: string;
  points: DxfPoint[];
};

export type DxfDoor = {
  a: DxfPoint; // hinge
  b: DxfPoint; // leaf tip menempel dinding
  nx: number;
  ny: number; // arah ayun (unit normal)
  leaves: 1 | 2;
  widthCm: number;
};

export type DxfExportInput = {
  pxPerMeter: number;
  /** Tebal dinding (meter), default 0.15 (150 mm). */
  wallThicknessM?: number;
  lines: DxfLine[];
  layers: DxfLayerPoly[];
  doors: DxfDoor[];
  parkingStallsByArea: Array<{ stalls: ParkingStall[] }>;
  parkingAreas: ParkingArea[];
  /** Rotasi mm-grid (radian) — perlu untuk konversi local→world path. */
  mmGridRotRad: number;
};

// ---------- Helpers ----------

function code(buf: string[], g: number, v: string | number) {
  buf.push(String(g));
  buf.push(typeof v === "number" ? formatNum(v) : v);
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // 6 desimal cukup untuk mm presisi pada satuan meter.
  return n.toFixed(6).replace(/\.?0+$/, "") || "0";
}

function pxToM(p: DxfPoint, ppm: number): DxfPoint {
  return { x: p.x / ppm, y: -p.y / ppm }; // flip Y
}

function emitLine(buf: string[], layer: string, a: DxfPoint, b: DxfPoint) {
  code(buf, 0, "LINE");
  code(buf, 8, layer);
  code(buf, 10, a.x); code(buf, 20, a.y); code(buf, 30, 0);
  code(buf, 11, b.x); code(buf, 21, b.y); code(buf, 31, 0);
}

function emitArc(
  buf: string[],
  layer: string,
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
) {
  // DXF ARC selalu CCW dari start→end.
  code(buf, 0, "ARC");
  code(buf, 8, layer);
  code(buf, 10, cx); code(buf, 20, cy); code(buf, 30, 0);
  code(buf, 40, r);
  code(buf, 50, startDeg);
  code(buf, 51, endDeg);
}

function emitLwPolyline(
  buf: string[],
  layer: string,
  pts: DxfPoint[],
  closed: boolean,
) {
  // R12 (AC1009) tidak mengenal LWPOLYLINE — pakai POLYLINE / VERTEX / SEQEND.
  if (pts.length < 2) return;
  code(buf, 0, "POLYLINE");
  code(buf, 8, layer);
  code(buf, 66, 1); // vertices follow
  code(buf, 70, closed ? 1 : 0);
  code(buf, 10, 0); code(buf, 20, 0); code(buf, 30, 0);
  for (const p of pts) {
    code(buf, 0, "VERTEX");
    code(buf, 8, layer);
    code(buf, 10, p.x);
    code(buf, 20, p.y);
    code(buf, 30, 0);
  }
  code(buf, 0, "SEQEND");
  code(buf, 8, layer);
}

function normalize(vx: number, vy: number): [number, number] {
  const L = Math.hypot(vx, vy) || 1;
  return [vx / L, vy / L];
}

// Sample arc segment dari titik a→b dengan sagitta (perpendicular) bulge px → polyline.
function sampleArcSagitta(a: DxfPoint, b: DxfPoint, sag: number, n = 24): DxfPoint[] {
  const out: DxfPoint[] = [];
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return [a, b];
  const [nx, ny] = [-dy / L, dx / L];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const k = 4 * t * (1 - t);
    out.push({ x: px + nx * sag * k, y: py + ny * sag * k });
  }
  return out;
}

function sampleBezier(
  a: DxfPoint, c1: DxfPoint, c2: DxfPoint, b: DxfPoint, n = 24,
): DxfPoint[] {
  const out: DxfPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x;
    const y = u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y;
    out.push({ x, y });
  }
  return out;
}

// ---------- Main builder ----------

export function buildDxf(input: DxfExportInput): string {
  const ppm = input.pxPerMeter;
  const wallT = input.wallThicknessM ?? 0.15;
  const half = wallT / 2;
  const buf: string[] = [];

  // ---- HEADER ----
  code(buf, 0, "SECTION");
  code(buf, 2, "HEADER");
  code(buf, 9, "$ACADVER"); code(buf, 1, "AC1009");
  code(buf, 9, "$INSUNITS"); code(buf, 70, 6); // 6 = meter
  code(buf, 9, "$MEASUREMENT"); code(buf, 70, 1);
  code(buf, 0, "ENDSEC");

  // ---- TABLES ----
  code(buf, 0, "SECTION");
  code(buf, 2, "TABLES");

  // LTYPE table — wajib agar AutoCAD menerima referensi linetype pada LAYER.
  code(buf, 0, "TABLE"); code(buf, 2, "LTYPE"); code(buf, 70, 1);
  code(buf, 0, "LTYPE");
  code(buf, 2, "CONTINUOUS");
  code(buf, 70, 0);
  code(buf, 3, "Solid line");
  code(buf, 72, 65);
  code(buf, 73, 0);
  code(buf, 40, 0);
  code(buf, 0, "ENDTAB");

  // LAYER table
  code(buf, 0, "TABLE"); code(buf, 2, "LAYER"); code(buf, 70, 8);
  const layerDefs: Array<{ name: string; color: number }> = [
    { name: "0", color: 7 },
    { name: "WALL", color: 7 },
    { name: "WALL-CENTER", color: 8 },
    { name: "ROOM", color: 3 },
    { name: "DOOR", color: 2 },
    { name: "PARKING-LOT", color: 5 },
    { name: "PARKING-AREA", color: 8 },
    { name: "PARKING-PATH", color: 1 },
  ];
  for (const ly of layerDefs) {
    code(buf, 0, "LAYER");
    code(buf, 2, ly.name);
    code(buf, 70, 0);
    code(buf, 62, ly.color);
    code(buf, 6, "CONTINUOUS");
  }
  code(buf, 0, "ENDTAB");
  code(buf, 0, "ENDSEC");

  // ---- BLOCKS (kosong, tetap diperlukan oleh sebagian parser) ----
  code(buf, 0, "SECTION");
  code(buf, 2, "BLOCKS");
  code(buf, 0, "ENDSEC");

  // ---- ENTITIES ----
  code(buf, 0, "SECTION");
  code(buf, 2, "ENTITIES");

  // Walls: 2 garis offset ± half (m) untuk tiap line.
  for (const ln of input.lines) {
    const am = pxToM(ln.a, ppm);
    const bm = pxToM(ln.b, ppm);

    if (ln.kind === "bezier" && ln.c1 && ln.c2) {
      const c1m = pxToM(ln.c1, ppm);
      const c2m = pxToM(ln.c2, ppm);
      const samples = sampleBezier(am, c1m, c2m, bm, 32);
      // Centerline + 2 offset polyline (approximate constant width)
      emitLwPolyline(buf, "WALL-CENTER", samples, false);
      const offA = offsetPolyline(samples, +half);
      const offB = offsetPolyline(samples, -half);
      emitLwPolyline(buf, "WALL", offA, false);
      emitLwPolyline(buf, "WALL", offB, false);
      continue;
    }
    if (ln.kind === "arc" && typeof ln.bulge === "number") {
      // konversi bulge px (perpendicular sagitta dunia) → meter
      const sagM = ln.bulge / ppm * -1; // flip Y → flip sagitta sign
      const samples = sampleArcSagitta(am, bm, sagM, 32);
      emitLwPolyline(buf, "WALL-CENTER", samples, false);
      const offA = offsetPolyline(samples, +half);
      const offB = offsetPolyline(samples, -half);
      emitLwPolyline(buf, "WALL", offA, false);
      emitLwPolyline(buf, "WALL", offB, false);
      continue;
    }

    // Straight wall: centerline + 2 offset lines (true 150mm tebal)
    const dx = bm.x - am.x, dy = bm.y - am.y;
    const [nx, ny] = normalize(-dy, dx);
    emitLine(buf, "WALL-CENTER", am, bm);
    emitLine(
      buf, "WALL",
      { x: am.x + nx * half, y: am.y + ny * half },
      { x: bm.x + nx * half, y: bm.y + ny * half },
    );
    emitLine(
      buf, "WALL",
      { x: am.x - nx * half, y: am.y - ny * half },
      { x: bm.x - nx * half, y: bm.y - ny * half },
    );
  }

  // Rooms: polygon tertutup.
  for (const lay of input.layers) {
    if (!lay.points || lay.points.length < 3) continue;
    const pts = lay.points.map((p) => pxToM(p, ppm));
    emitLwPolyline(buf, "ROOM", pts, true);
  }

  // Doors: ARC bukaan + LINE daun pintu (radius = lebar bukaan, dalam meter).
  for (const d of input.doors) {
    const am = pxToM(d.a, ppm); // hinge
    const bm = pxToM(d.b, ppm); // leaf tip
    // normal di-flip Y juga
    const ny = -d.ny;
    const nx = d.nx;
    const widthM = (d.widthCm / 100);
    if (d.leaves === 2) {
      // dua daun setengah lebar dari kedua sisi (hinge a, hinge b)
      const half = widthM / 2;
      // hinge kiri = a (radius half), arah swing menjauh dari dinding (n)
      drawDoorLeaf(buf, am, bm, nx, ny, half, +1);
      // hinge kanan = b (radius half), arah swing sama
      drawDoorLeaf(buf, bm, am, nx, ny, half, -1);
    } else {
      drawDoorLeaf(buf, am, bm, nx, ny, widthM, +1);
    }
  }

  // Parking areas: outline (poligon area) tipis.
  for (const area of input.parkingAreas) {
    if (!area.pointsLocal || area.pointsLocal.length < 3) continue;
    const cs = Math.cos(input.mmGridRotRad), sn = Math.sin(input.mmGridRotRad);
    const worldPx = area.pointsLocal.map((q) => ({
      x: q.x * cs - q.y * sn,
      y: q.x * sn + q.y * cs,
    }));
    const ptsM = worldPx.map((p) => pxToM(p, ppm));
    emitLwPolyline(buf, "PARKING-AREA", ptsM, true);

    // Jalur parkir (polyline) — di layer PARKING-PATH.
    for (const path of area.paths ?? []) {
      const w = path.pointsLocal.map((q) => ({
        x: q.x * cs - q.y * sn,
        y: q.x * sn + q.y * cs,
      }));
      const pm = w.map((p) => pxToM(p, ppm));
      emitLwPolyline(buf, "PARKING-PATH", pm, false);
    }
  }

  // Parking stalls: tiap stall = closed LWPOLYLINE.
  for (const grp of input.parkingStallsByArea) {
    for (const s of grp.stalls) {
      if (!s.valid) continue;
      const pts = s.poly.map((p) => pxToM(p, ppm));
      emitLwPolyline(buf, "PARKING-LOT", pts, true);
    }
  }

  code(buf, 0, "ENDSEC");
  code(buf, 0, "EOF");

  return buf.join("\n");
}

function drawDoorLeaf(
  buf: string[],
  hinge: DxfPoint,
  tip: DxfPoint,
  nx: number,
  ny: number,
  r: number,
  sign: 1 | -1,
) {
  // tip→hinge vektor → sudut start (daun tertutup di dinding)
  const sx = tip.x - hinge.x, sy = tip.y - hinge.y;
  const startRad = Math.atan2(sy, sx);
  // sudut akhir = rotasi 90° ke arah normal swing
  // Pastikan endRad = startRad + sign*90° (CCW vs CW).
  const sweep = (Math.PI / 2) * sign;
  // Tentukan CCW DXF: ARC selalu CCW dari start→end.
  let s = startRad;
  let e = startRad + sweep;
  // pakai swing arah normal — pilih sign berdasarkan cross product (tip-hinge) × (n)
  const cross = sx * ny - sy * nx;
  if (cross < 0) { e = startRad - Math.PI / 2; }
  else { e = startRad + Math.PI / 2; }
  if (sign === -1) {
    // mirror untuk daun ke-2
    e = startRad - (e - startRad);
  }
  // Normalisasi: DXF butuh CCW; swap kalau perlu.
  let sd = (s * 180 / Math.PI + 360) % 360;
  let ed = (e * 180 / Math.PI + 360) % 360;
  emitArc(buf, "DOOR", hinge.x, hinge.y, r, sd, ed);
  // Daun pintu sebagai LINE dari hinge ke titik akhir bukaan.
  const ex = hinge.x + Math.cos(e) * r;
  const ey = hinge.y + Math.sin(e) * r;
  emitLine(buf, "DOOR", hinge, { x: ex, y: ey });
}

// Offset polyline (sederhana, per-vertex normal rata-rata).
function offsetPolyline(pts: DxfPoint[], d: number): DxfPoint[] {
  const out: DxfPoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[i - 1] ?? pts[i];
    const next = pts[i + 1] ?? pts[i];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const [nx, ny] = normalize(-dy, dx);
    out.push({ x: pts[i].x + nx * d, y: pts[i].y + ny * d });
  }
  return out;
}

// ---------- Download helper ----------

export function downloadDxf(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".dxf") ? filename : `${filename}.dxf`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}
