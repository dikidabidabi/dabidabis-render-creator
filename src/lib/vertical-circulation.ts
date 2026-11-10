// Hubungan vertikal antar-lantai untuk Diagram Hubungan Ruang Total.
// Lift, tangga, atau ramp di lantai berbeda dianggap terhubung bila berada
// pada grid/koordinat yang sama atau titik pusatnya berjarak horizontal
// kurang dari radius (bawaan 3 m). Hanya lantai berurutan yang dihubungkan
// sehingga terbentuk rantai lantai bawah → atas tanpa garis berlebih.

export type VerticalKind = "lift" | "tangga" | "ramp";

export function verticalCirculationKind(name: string): VerticalKind | null {
  const n = name.toLowerCase();
  if (/\blift\b|\belevator\b/.test(n)) return "lift";
  if (/\btangga\b|\bstair/.test(n)) return "tangga";
  if (/\bramp\b/.test(n)) return "ramp";
  return null;
}

export type VerticalNode = {
  id: string;
  levelId: string;
  name: string;
  /** Titik pusat denah dalam meter. */
  x: number;
  y: number;
};

export type VerticalLink = { source: string; target: string; kind: VerticalKind; distanceM: number };

export const VERTICAL_LINK_RADIUS_M = 3;

/**
 * @param levelOrder ID level dari lantai terendah ke tertinggi.
 */
export function buildVerticalLinks(
  nodes: VerticalNode[],
  levelOrder: string[],
  radiusM = VERTICAL_LINK_RADIUS_M,
): VerticalLink[] {
  const rank = new Map(levelOrder.map((id, index) => [id, index]));
  const candidates = nodes
    .map((node) => ({ node, kind: verticalCirculationKind(node.name), rank: rank.get(node.levelId) }))
    .filter((item): item is { node: VerticalNode; kind: VerticalKind; rank: number } => item.kind !== null && item.rank !== undefined);
  const links: VerticalLink[] = [];
  const EPS = 1e-6;
  for (const lower of candidates) {
    // Cari lantai berikutnya di atas yang memiliki elemen sejenis dalam radius.
    let best: { node: VerticalNode; rank: number; distance: number } | null = null;
    for (const upper of candidates) {
      if (upper.kind !== lower.kind || upper.rank <= lower.rank) continue;
      const distance = Math.hypot(upper.node.x - lower.node.x, upper.node.y - lower.node.y);
      if (distance >= radiusM && distance > EPS) continue;
      if (!best || upper.rank < best.rank || (upper.rank === best.rank && distance < best.distance)) {
        best = { node: upper.node, rank: upper.rank, distance };
      }
    }
    if (best) links.push({ source: lower.node.id, target: best.node.id, kind: lower.kind, distanceM: best.distance });
  }
  return links;
}
