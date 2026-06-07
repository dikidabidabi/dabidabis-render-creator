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
  /** Bobot tebal garis. 1 = adjacency biasa, 2 = ada pintu. */
  weight: number;
  hasDoor: boolean;
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

/** Bangun nodes + edges adjacency dari ruang-ruang pada satu level. */
export function buildBubbleGraph(
  rooms: RoomLike[],
  doors: DoorLike[],
  tolerancePx: number,
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

  // 1) Adjacency berbasis jarak perimeter.
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const A = rooms[i], B = rooms[j];
      if (A.points.length < 3 || B.points.length < 3) continue;
      const d = polygonMinDist(A.points, B.points);
      if (d <= tolerancePx) {
        const k = keyOf(A.id, B.id);
        linkMap.set(k, { source: A.id, target: B.id, weight: 1, hasDoor: false });
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
      existing.hasDoor = true;
      existing.weight = 2;
    } else {
      linkMap.set(k, { source: roomA.id, target: roomB.id, weight: 2, hasDoor: true });
    }
  }

  return { nodes, links: Array.from(linkMap.values()) };
}
