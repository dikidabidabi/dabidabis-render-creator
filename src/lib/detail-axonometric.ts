// Slide "Detail Aksonometri": susunan Detail 3D semua lantai secara
// aksonometri (eksplode vertikal) dengan garis putus-putus yang
// menghubungkan lift dan tangga antar-lantai. Murni (tanpa Three.js) agar
// susunan dan penghubungnya bisa diuji.

import { roomLabelPoint, type Detail3dInput } from "@/lib/level-detail-3d";
import { buildVerticalLinks, verticalCirculationKind } from "@/lib/vertical-circulation";
import { stairPlanGeometry, type Stair } from "@/lib/stairs";

type P = { x: number; y: number };

export type AxoLinkKind = "lift" | "tangga";

/** Titik denah (meter) pada level tertentu. */
export type AxoAnchor = { levelId: string; x: number; y: number };
export type AxoLink = { kind: AxoLinkKind; from: AxoAnchor; to: AxoAnchor };

export type AxoStackLevel = { levelId: string; mdpl: number; input: Detail3dInput };

/** Jarak renggang antar-lantai (m): sebanding bentang denah agar tiap lantai terbaca. */
export function detailAxoGap(spanM: number): number {
  const span = Number.isFinite(spanM) ? spanM : 0;
  return Math.min(50, Math.max(3, span));
}

/**
 * Elevasi dasar tiap lantai di susunan: lantai terendah di 0, lantai
 * berikutnya di atas dinding lantai sebelumnya ditambah jarak renggang.
 */
export function detailAxoStack(levels: AxoStackLevel[], gapM: number): Array<{ levelId: string; base: number }> {
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  let base = 0;
  return sorted.map((level) => {
    const out = { levelId: level.levelId, base };
    base += Math.max(0.1, Number(level.input.wallHeight) || 0) + Math.max(0, gapM);
    return out;
  });
}

function center(points: P[]): P {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/**
 * Penghubung lift & tangga antar-lantai berurutan di susunan:
 * - ruang bernama Lift/Tangga yang sejenis dan berdekatan (≤ 3 m) di lantai berikutnya;
 * - objek tangga sketsa dari level asal ke level tujuan bila keduanya disusun,
 *   kecuali sudah diwakili ruang Tangga di posisi yang sama.
 */
export function detailAxoLinks(levels: AxoStackLevel[], stairs: Stair[] = []): AxoLink[] {
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const order = sorted.map((level) => level.levelId);
  const nodes: Array<{ id: string; levelId: string; name: string; x: number; y: number }> = [];
  for (const level of sorted) {
    const ppm = level.input.pxPerMeter > 0 ? level.input.pxPerMeter : 1;
    level.input.rooms.forEach((room, index) => {
      const kind = verticalCirculationKind(room.name);
      if ((kind !== "lift" && kind !== "tangga") || room.points.length < 3) return;
      const c = roomLabelPoint(room.points.map((p) => ({ x: p.x / ppm, y: p.y / ppm })));
      nodes.push({ id: `${level.levelId}::${room.id ?? index}`, levelId: level.levelId, name: room.name, x: c.x, y: c.y });
    });
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const links: AxoLink[] = [];
  for (const link of buildVerticalLinks(nodes, order)) {
    const a = byId.get(link.source), b = byId.get(link.target);
    if (!a || !b || link.kind === "ramp") continue;
    links.push({ kind: link.kind, from: { levelId: a.levelId, x: a.x, y: a.y }, to: { levelId: b.levelId, x: b.x, y: b.y } });
  }
  const rank = new Map(order.map((id, index) => [id, index]));
  const ppm = sorted[0]?.input.pxPerMeter && sorted[0].input.pxPerMeter > 0 ? sorted[0].input.pxPerMeter : 1;
  for (const stair of stairs) {
    const ra = rank.get(stair.levelId), rb = rank.get(stair.toLevelId);
    if (ra === undefined || rb === undefined || ra === rb) continue;
    let footprint: P[] = [];
    try { footprint = stairPlanGeometry(stair, ppm).footprint; } catch { footprint = []; }
    const c = center(footprint.length ? footprint : [stair.a, stair.b]);
    const x = c.x / ppm, y = c.y / ppm;
    const [lower, upper] = ra < rb ? [stair.levelId, stair.toLevelId] : [stair.toLevelId, stair.levelId];
    const covered = links.some((link) => link.kind === "tangga" && link.from.levelId === lower && link.to.levelId === upper
      && Math.hypot(link.from.x - x, link.from.y - y) < 3);
    if (covered) continue;
    links.push({ kind: "tangga", from: { levelId: lower, x, y }, to: { levelId: upper, x, y } });
  }
  return links;
}
