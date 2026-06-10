// Topologi virtual: pecah garis lurus pada tiap titik potong dengan garis lain.
// Tidak mengubah array `lines` asli — segmen hanya hidup di runtime untuk
// keperluan attribute painter (material edge) dan rendering 2D di slide.

export type Point = { x: number; y: number };

export type EdgeMaterial = "solid" | "curtain" | "window" | "railing";

// Garis input (subset dari Line di sketch.tsx).
export type StraightLineInput = {
  a: Point;
  b: Point;
  kind?: "straight" | "arc" | "bezier";
  levelId?: string;
};

export type EdgeSegment = {
  id: string;
  a: Point;
  b: Point;
  sourceLineIndex: number;
  levelId?: string;
};

const ROUND = 1000; // 3 desimal — toleransi pembulatan koordinat.
const EPS = 1e-6;

function r(n: number): number {
  return Math.round(n * ROUND) / ROUND;
}

/** Id stabil berdasar pasangan endpoint, urut agar arah tidak peduli. */
export function segmentIdFor(a: Point, b: Point): string {
  const ax = r(a.x), ay = r(a.y);
  const bx = r(b.x), by = r(b.y);
  const aKey = `${ax},${ay}`;
  const bKey = `${bx},${by}`;
  return aKey <= bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

/** Interseksi dua segmen (lurus). Mengembalikan parameter t pada AB ([0..1]) jika
 *  terjadi pemotongan strict (bukan endpoint), null jika tidak. */
function intersectParam(
  a1: Point, a2: Point, b1: Point, b2: Point,
): number | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return null;
  const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / denom;
  const u = ((b1.x - a1.x) * ry - (b1.y - a1.y) * rx) / denom;
  // Tolak jika sangat dekat endpoint (sudah ada sebagai node).
  if (t < EPS || t > 1 - EPS) return null;
  if (u < EPS || u > 1 - EPS) return null;
  return t;
}

/** Pecah garis-garis lurus pada titik potong satu sama lain.
 *  Garis arc/bezier dibiarkan utuh (1 segmen). */
export function computeStraightSegments(lines: StraightLineInput[]): EdgeSegment[] {
  const out: EdgeSegment[] = [];
  // Indeks garis lurus saja untuk pencarian interseksi cepat.
  const straightIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i].kind ?? "straight") === "straight") straightIdx.push(i);
  }
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if ((ln.kind ?? "straight") !== "straight") {
      out.push({
        id: segmentIdFor(ln.a, ln.b),
        a: ln.a, b: ln.b,
        sourceLineIndex: i,
        levelId: ln.levelId,
      });
      continue;
    }
    // Kumpulkan parameter t pada garis i untuk tiap interseksi dengan garis lurus j.
    const ts: number[] = [0, 1];
    for (const j of straightIdx) {
      if (j === i) continue;
      // Batasi split per level — material berbasis denah; potongan di level lain
      // tidak relevan. Tetap pecah lintas-level kalau kedua garis memang berpotong
      // di sketsa yang sama (untuk konsistensi visual saat picking di kanvas).
      const lj = lines[j];
      const t = intersectParam(ln.a, ln.b, lj.a, lj.b);
      if (t != null) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    // Dedupe.
    const uniq: number[] = [];
    for (const t of ts) {
      if (uniq.length === 0 || Math.abs(uniq[uniq.length - 1] - t) > 1e-4) uniq.push(t);
    }
    for (let k = 0; k < uniq.length - 1; k++) {
      const t0 = uniq[k], t1 = uniq[k + 1];
      const a: Point = { x: ln.a.x + (ln.b.x - ln.a.x) * t0, y: ln.a.y + (ln.b.y - ln.a.y) * t0 };
      const b: Point = { x: ln.a.x + (ln.b.x - ln.a.x) * t1, y: ln.a.y + (ln.b.y - ln.a.y) * t1 };
      out.push({
        id: segmentIdFor(a, b),
        a, b,
        sourceLineIndex: i,
        levelId: ln.levelId,
      });
    }
  }
  return out;
}

function pointSegDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

/** Segmen terdekat terhadap titik (dalam koordinat dunia yang sama).
 *  tol dalam unit dunia. Mengembalikan null jika tidak ada dalam toleransi. */
export function pickSegmentAt(
  p: Point,
  segments: EdgeSegment[],
  tol: number,
  filter?: (seg: EdgeSegment) => boolean,
): EdgeSegment | null {
  let best: EdgeSegment | null = null;
  let bestD = Infinity;
  for (const s of segments) {
    if (filter && !filter(s)) continue;
    const d = pointSegDistance(p, s.a, s.b);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best || bestD > tol) return null;
  return best;
}

/** Interseksi segmen edge dengan segmen cut. Jika berpotongan, kembalikan parameter
 *  t sepanjang cut (0..1), jika tidak null. */
export function intersectSegmentWithCut(
  seg: { a: Point; b: Point },
  cutA: Point,
  cutB: Point,
): number | null {
  const rx = cutB.x - cutA.x;
  const ry = cutB.y - cutA.y;
  const sx = seg.b.x - seg.a.x;
  const sy = seg.b.y - seg.a.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return null;
  const t = ((seg.a.x - cutA.x) * sy - (seg.a.y - cutA.y) * sx) / denom;
  const u = ((seg.a.x - cutA.x) * ry - (seg.a.y - cutA.y) * rx) / denom;
  if (t < -EPS || t > 1 + EPS) return null;
  if (u < -EPS || u > 1 + EPS) return null;
  return Math.max(0, Math.min(1, t));
}

export const MATERIAL_COLORS: Record<EdgeMaterial, string> = {
  solid: "#0a0a0a",
  curtain: "#22d3ee",
  window: "#1e3a8a",
  railing: "#8b5a2b",
};

export const MATERIAL_LABELS: Record<EdgeMaterial, string> = {
  solid: "Dinding Solid",
  curtain: "Curtain Wall",
  window: "Window Wall",
  railing: "Railing",
};
