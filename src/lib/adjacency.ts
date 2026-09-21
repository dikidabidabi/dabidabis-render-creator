// Spatial adjacency for room polygons (denah).
// Pure topology: dua ruang dianggap "berdekatan" bila perimeter mereka
// saling menempel (jarak titik-ke-segmen ≤ toleransi px), atau bila
// terhubung lewat sebuah pintu (Door).

export type Pt = { x: number; y: number };

export type RoomNode = {
  layerId: string;
  name: string;
  areaM2: number;
  /** centroid poligon (px), untuk inisialisasi posisi simulasi. */
  cx: number;
  cy: number;
  /** warna fill (rgba string, ALPHA placeholder masih ada). */
  color: string;
  /** koefisien koefisien sub-layer (1, 0.5, 0). */
  coefficient: number;
};

export type RoomLink = {
  source: string; // layerId
  target: string; // layerId
  /** Bobot simulasi; gaya visual ditentukan oleh `relation`. */
  weight: number;
  relation: "direct" | "door" | "wall";
};

function segDistSq(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) {
    const ex = p.x - a.x, ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const ex = p.x - (a.x + t * dx);
  const ey = p.y - (a.y + t * dy);
  return ex * ex + ey * ey;
}

/** Jarak minimum antar dua poligon (perimeter), via point-to-segment.
 *  Cukup akurat untuk deteksi "menempel". */
function polygonMinDist(A: Pt[], B: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < A.length; i++) {
    const p = A[i];
    for (let j = 0; j < B.length; j++) {
      const a = B[j], b = B[(j + 1) % B.length];
      const d2 = segDistSq(p, a, b);
      if (d2 < best) best = d2;
    }
  }
  for (let i = 0; i < B.length; i++) {
    const p = B[i];
    for (let j = 0; j < A.length; j++) {
      const a = A[j], b = A[(j + 1) % A.length];
      const d2 = segDistSq(p, a, b);
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

function polygonsShareSide(A: Pt[], B: Pt[], tolerancePx: number): boolean {
  if (polygonMinDist(A, B) > tolerancePx) return false;
  const requiredOverlap = Math.max(2, tolerancePx * 0.25);
  const minParallelCos = Math.cos(Math.PI / 12);

  for (let i = 0; i < A.length; i++) {
    const a0 = A[i], a1 = A[(i + 1) % A.length];
    const adx = a1.x - a0.x, ady = a1.y - a0.y;
    const aLength = Math.hypot(adx, ady);
    if (aLength < 1e-6) continue;
    const ux = adx / aLength, uy = ady / aLength;

    for (let j = 0; j < B.length; j++) {
      const b0 = B[j], b1 = B[(j + 1) % B.length];
      const bdx = b1.x - b0.x, bdy = b1.y - b0.y;
      const bLength = Math.hypot(bdx, bdy);
      if (bLength < 1e-6) continue;
      const parallelCos = Math.abs((adx * bdx + ady * bdy) / (aLength * bLength));
      if (parallelCos < minParallelCos) continue;

      const b0Along = (b0.x - a0.x) * ux + (b0.y - a0.y) * uy;
      const b1Along = (b1.x - a0.x) * ux + (b1.y - a0.y) * uy;
      const overlap = Math.min(aLength, Math.max(b0Along, b1Along))
        - Math.max(0, Math.min(b0Along, b1Along));
      if (overlap < requiredOverlap) continue;

      const b0Across = Math.abs((b0.x - a0.x) * -uy + (b0.y - a0.y) * ux);
      const b1Across = Math.abs((b1.x - a0.x) * -uy + (b1.y - a0.y) * ux);
      if (Math.min(b0Across, b1Across) <= tolerancePx) return true;
    }
  }
  return false;
}

function pointPolygonPerimeterDist(p: Pt, poly: Pt[]): number {
  let bestSq = Infinity;
  for (let i = 0; i < poly.length; i++) {
    bestSq = Math.min(bestSq, segDistSq(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return Math.sqrt(bestSq);
}

/** Garis pembatas dianggap berada di antara dua ruang bila sebagian panjangnya
 * mengikuti kedua perimeter. Syarat dua sampel yang terpisah menghindari garis
 * di sudut pertemuan ruang terbaca sebagai dinding pemisah. */
function hasSharedBoundaryLine(
  roomA: RoomLike,
  roomB: RoomLike,
  lines: BoundaryLineLike[],
  tolerancePx: number,
): boolean {
  const boundaryTolerance = Math.max(1, tolerancePx * 0.55);
  for (const line of lines) {
    const length = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
    if (length < 1e-6) continue;
    const sampleCount = Math.max(4, Math.min(80, Math.ceil(length / Math.max(1, boundaryTolerance * 0.5))));
    let firstMatch = -1;
    let lastMatch = -1;
    for (let i = 0; i <= sampleCount; i++) {
      const t = i / sampleCount;
      const p = {
        x: line.a.x + (line.b.x - line.a.x) * t,
        y: line.a.y + (line.b.y - line.a.y) * t,
      };
      if (
        pointPolygonPerimeterDist(p, roomA.points) <= boundaryTolerance
        && pointPolygonPerimeterDist(p, roomB.points) <= boundaryTolerance
      ) {
        if (firstMatch < 0) firstMatch = i;
        lastMatch = i;
      }
    }
    if (firstMatch >= 0 && lastMatch > firstMatch) {
      const matchedLength = ((lastMatch - firstMatch) / sampleCount) * length;
      if (matchedLength >= Math.max(1, boundaryTolerance * 0.5)) return true;
    }
  }
  return false;
}

function polygonCentroid(pts: Pt[]): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    cx += (pts[i].x + pts[j].x) * cross;
    cy += (pts[i].y + pts[j].y) * cross;
    a += cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-6) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export type RoomLike = {
  id: string;
  name: string;
  points: Pt[];
  areaM2: number;
  color: string;
  coefficient?: number;
  levelId?: string;
};

export type DoorLike = {
  a: Pt; b: Pt; nx: number; ny: number; widthCm: number; levelId?: string;
};

export type BoundaryLineLike = {
  a: Pt;
  b: Pt;
  levelId?: string;
};

/** Bangun nodes + edges adjacency dari ruang-ruang pada satu level. */
export function buildBubbleGraph(
  rooms: RoomLike[],
  doors: DoorLike[],
  tolerancePx: number,
  boundaryLines: BoundaryLineLike[] = [],
): { nodes: RoomNode[]; links: RoomLink[] } {
  const nodes: RoomNode[] = rooms.map((r) => {
    const c = polygonCentroid(r.points);
    return {
      layerId: r.id,
      name: r.name,
      areaM2: r.areaM2,
      cx: c.x,
      cy: c.y,
      color: r.color,
      coefficient: r.coefficient ?? 1,
    };
  });

  const linkMap = new Map<string, RoomLink>();
  const keyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // 1) Adjacency berbasis jarak perimeter. Garis pembatas membedakan ruang
  //    terbuka langsung dari ruang yang dipisahkan dinding.
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const A = rooms[i], B = rooms[j];
      if (A.points.length < 3 || B.points.length < 3) continue;
      if (polygonsShareSide(A.points, B.points, tolerancePx)) {
        const k = keyOf(A.id, B.id);
        const relation = hasSharedBoundaryLine(A, B, boundaryLines, tolerancePx) ? "wall" : "direct";
        linkMap.set(k, {
          source: A.id,
          target: B.id,
          weight: relation === "direct" ? 2.2 : 1,
          relation,
        });
      }
    }
  }

  // 2) Pintu → boost weight (dan tambahkan link bila belum ada).
  //    Sisi A = titik tengah pintu + offset kecil ke arah +n. Sisi B = -n.
  const midOffsetPx = Math.max(2, tolerancePx * 0.6);
  for (const d of doors) {
    const mx = (d.a.x + d.b.x) / 2;
    const my = (d.a.y + d.b.y) / 2;
    const pA: Pt = { x: mx + d.nx * midOffsetPx, y: my + d.ny * midOffsetPx };
    const pB: Pt = { x: mx - d.nx * midOffsetPx, y: my - d.ny * midOffsetPx };
    let roomA: RoomLike | null = null;
    let roomB: RoomLike | null = null;
    for (const r of rooms) {
      if (r.points.length < 3) continue;
      if (!roomA && pointInPolygon(pA, r.points)) roomA = r;
      if (!roomB && pointInPolygon(pB, r.points)) roomB = r;
      if (roomA && roomB) break;
    }
    if (!roomA || !roomB || roomA.id === roomB.id) continue;
    const k = keyOf(roomA.id, roomB.id);
    const existing = linkMap.get(k);
    if (existing) {
      existing.relation = "door";
      existing.weight = 2;
    } else {
      linkMap.set(k, { source: roomA.id, target: roomB.id, weight: 2, relation: "door" });
    }
  }

  return { nodes, links: Array.from(linkMap.values()) };
}
