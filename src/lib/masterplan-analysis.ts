// Analysis helpers for the masterplan canvas (dabidabis_masterplan_canvas_v1).
// Menghasilkan data ringkas untuk slide presentasi "Analisis Master Plan Kawasan"
// dan "Siteplan Kawasan": bangunan (root + sub), luasan Lahan, jalan (union),
// serta polygon top-view dan skyline.

import polygonClipping from "polygon-clipping";
import {
  roadCorridorPolygon,
  unionFilletedCorridors,
  clipRingsByPolygon,
  type RoadSegment,
} from "@/lib/roads";
import { normalizeAnnotations, normalizeIluLayer, type Annotation, type IluLayerCfg } from "@/lib/analysis-illustrations";

export type Pt = { x: number; y: number };

type AnyLayer = {
  id: string;
  name: string;
  points: Pt[];
  areaM2: number;
  color?: string;
  hidden?: boolean;
  locked?: boolean;
  levelId?: string;
  floors?: number;
  isReferenceRoom?: boolean;
};

type AnyLevel = {
  id: string;
  name: string;
  mdpl: number;
  parentLayerId?: string;
};

type AnyGeo = { mapRotation?: number; lat?: number; lon?: number; locked?: boolean; mapOpacity?: number };

type AnySketch = {
  id: string;
  title: string;
  scale?: string;
  layers: AnyLayer[];
  levels: AnyLevel[];
  roads?: RoadSegment[];
  illustrations?: unknown;
  illustrationLayer?: unknown;
  linkedMasterplan?: { rootLayerId: string };
  geo?: AnyGeo;
};

const MP_KEY = "dabidabis_masterplan_canvas_v1";
const SCALE_TO_PXM: Record<string, number> = {
  "1:100": 80,
  "1:200": 40,
  "1:500": 16,
  "1:1000": 8,
  "1:1200": 80 / 12,
  "1:1500": 80 / 15,
  "1:2000": 4,
};

export function pxPerMeterOf(scale: string | undefined): number {
  if (!scale) return SCALE_TO_PXM["1:100"];
  const v = SCALE_TO_PXM[scale];
  return Number.isFinite(v) && v > 0 ? v : SCALE_TO_PXM["1:100"];
}

function isLahan(n: string) {
  return n.trim().toLowerCase().startsWith("lahan");
}

function polyAreaPx(pts: Pt[]): number {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function polyCentroid(pts: Pt[]): Pt {
  if (!pts || pts.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / pts.length, y: sy / pts.length };
}

export type SubMassInfo = { name: string; color: string; polygonPx: Pt[]; centroidPx: Pt; floors: number; areaM2: number; heightM: number; baseM: number };

export type BuildingInfo = {
  id: string;
  name: string;
  color: string;
  polygonPx: Pt[];
  centroidPx: Pt;
  footprintM2: number;
  totalFloors: number;
  totalGfaM2: number;
  heightM: number;
  subMasses: SubMassInfo[];
};

export type LahanInfo = { name: string; color: string; polygonPx: Pt[] };

export type MasterplanAnalysis = {
  sketchId: string;
  title: string;
  scale: string;
  pxm: number;
  mapRotationDeg: number;
  boundsPx: { minX: number; minY: number; maxX: number; maxY: number };
  lahanPolygonsPx: Pt[][];
  lahanInfos: LahanInfo[];
  totalLahanM2: number;
  buildings: BuildingInfo[];
  totalFootprintM2: number;
  totalGfaM2: number;
  roadRingsPx: { outer: Pt[]; holes: Pt[][] }[];
  totalRoadAreaM2: number;
  kdbKawasanPct: number;
  illustrations: Annotation[];
  geo?: { lat: number; lon: number; mapOpacity: number; mapRotation: number };
};

export function loadMasterplanAnalysis(rootLayerId?: string): MasterplanAnalysis | null {
  if (typeof window === "undefined") return null;
  let store: { sketches: AnySketch[]; openId: string | null };
  try {
    const raw = window.localStorage.getItem(MP_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    store = {
      sketches: Array.isArray(j?.sketches) ? j.sketches : [],
      openId: typeof j?.openId === "string" ? j.openId : null,
    };
  } catch {
    return null;
  }
  // Bila rootLayerId diberikan, cari masterplan sketch yang memuat layer tsb.
  // Ini memastikan analisis kawasan mengikuti masterplan SUMBER bangunan yang
  // diekspor ke halaman sketsa — bukan masterplan yang kebetulan aktif.
  let sk: AnySketch | undefined;
  if (rootLayerId) {
    sk = store.sketches.find((s) => (s.layers || []).some((l) => l.id === rootLayerId));
  }
  if (!sk) sk = store.sketches.find((s) => s.id === store.openId) ?? store.sketches[0];
  if (!sk) return null;
  return analyze(sk);
}

function analyze(sk: AnySketch): MasterplanAnalysis {
  const pxm = pxPerMeterOf(sk.scale);
  const layers = (sk.layers || []).filter((l) => !l.hidden);
  const levels = sk.levels || [];

  // Lahan polygons (root parcels)
  const lahanLayers = layers.filter((l) => isLahan(l.name) && l.points.length >= 3);
  const lahanPolygonsPx = lahanLayers.map((l) => l.points);
  const lahanInfos: LahanInfo[] = lahanLayers.map((l) => ({ name: l.name || "Lahan", color: l.color || "#e5e7eb", polygonPx: l.points }));
  const totalLahanM2 = lahanLayers.reduce((s, l) => s + (Number(l.areaM2) || polyAreaPx(l.points) / (pxm * pxm)), 0);

  // Root buildings = non-Lahan layers whose level has no parentLayerId AND
  // layer itself is not a reference or sub. In masterplan mode, all non-Lahan
  // layers whose level.parentLayerId is undefined count as root buildings.
  const roots: AnyLayer[] = [];
  for (const l of layers) {
    if (isLahan(l.name)) continue;
    if (l.isReferenceRoom) continue;
    if (l.points.length < 3) continue;
    const lvl = levels.find((v) => v.id === l.levelId);
    if (lvl?.parentLayerId) continue; // sub-mass, handled in aggregate
    roots.push(l);
  }

  function aggregate(rootId: string): { floors: number; area: number; subs: SubMassInfo[] } {
    let f = 0, a = 0;
    const subs: SubMassInfo[] = [];
    const walk = (lid: string, baseFloors: number) => {
      for (const child of levels) {
        if (child.parentLayerId !== lid) continue;
        for (const ch of layers) {
          if (ch.levelId !== child.id) continue;
          if (isLahan(ch.name)) continue;
          const cf = Math.max(1, Math.round(Number(ch.floors) || 1));
          const ca = Number(ch.areaM2) || polyAreaPx(ch.points) / (pxm * pxm);
          f += cf;
          a += ca * cf;
          subs.push({
            name: ch.name || "Sub",
            color: ch.color || "#94a3b8",
            polygonPx: ch.points,
            centroidPx: polyCentroid(ch.points),
            floors: cf,
            areaM2: ca,
            heightM: cf * 4,
            baseM: baseFloors * 4,
          });
          walk(ch.id, baseFloors + cf);
        }
      }
    };
    walk(rootId, 0);
    return { floors: f, area: a, subs };
  }

  const buildings: BuildingInfo[] = roots.map((r) => {
    const ownFloors = Math.max(1, Math.round(Number(r.floors) || 1));
    const ownArea = Number(r.areaM2) || polyAreaPx(r.points) / (pxm * pxm);
    const agg = aggregate(r.id);
    const totalFloors = ownFloors + agg.floors;
    const totalGfa = ownArea * ownFloors + agg.area;
    return {
      id: r.id,
      name: r.name || "Bangunan",
      color: r.color || "#64748b",
      polygonPx: r.points,
      centroidPx: polyCentroid(r.points),
      footprintM2: ownArea,
      totalFloors,
      totalGfaM2: totalGfa,
      heightM: totalFloors * 4,
      subMasses: agg.subs,
    };
  });

  const totalFootprintM2 = buildings.reduce((s, b) => s + b.footprintM2, 0);
  const totalGfaM2 = buildings.reduce((s, b) => s + b.totalGfaM2, 0);

  // Roads: union of corridor polygons clipped by union of Lahan
  const roads = (sk.roads || []).filter((r) => r && r.points && r.points.length >= 2);
  let roadRingsPx: { outer: Pt[]; holes: Pt[][] }[] = [];
  let totalRoadAreaM2 = 0;
  if (roads.length > 0 && lahanLayers.length > 0) {
    try {
      const FILLET_PX = 4 * pxm;
      const corridors = roads
        .map((r) => roadCorridorPolygon(r, pxm) as Pt[])
        .filter((c) => c.length >= 3);
      if (corridors.length > 0) {
        let rings = unionFilletedCorridors(corridors, FILLET_PX);
        // Clip by union of Lahan polygons
        const lahanPolys = lahanLayers.map((l) => [ptsToRing(l.points)]) as any;
        const lahanUnion = (polygonClipping.union as any)(...lahanPolys);
        // clipRingsByPolygon expects a single polygon; use outer of first union piece.
        // But we can do difference-based clip via polygon-clipping intersection.
        const roadPolys = rings.map((r) => [ptsToRing(r.outer), ...r.holes.map(ptsToRing)]);
        const clipped = polygonClipping.intersection(
          roadPolys as any,
          lahanUnion as any,
        );
        roadRingsPx = [];
        let areaPx = 0;
        for (const poly of clipped) {
          if (!poly[0]) continue;
          const outer = ringToPts(poly[0]);
          const holes = poly.slice(1).map((h) => ringToPts(h));
          if (outer.length < 3) continue;
          roadRingsPx.push({ outer, holes });
          areaPx += polyAreaPx(outer) - holes.reduce((s, h) => s + polyAreaPx(h), 0);
        }
        totalRoadAreaM2 = Math.max(0, areaPx) / (pxm * pxm);
        // fallback if intersection produced nothing
        if (roadRingsPx.length === 0) {
          rings = clipRingsByPolygon(rings, lahanLayers[0].points);
          for (const r of rings) {
            roadRingsPx.push({ outer: r.outer, holes: r.holes });
            totalRoadAreaM2 += polyAreaPx(r.outer) / (pxm * pxm);
            for (const h of r.holes) totalRoadAreaM2 -= polyAreaPx(h) / (pxm * pxm);
          }
          totalRoadAreaM2 = Math.max(0, totalRoadAreaM2);
        }
      }
    } catch {
      // best-effort; ignore
    }
  }

  // Bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (pts: Pt[]) => {
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
  };
  lahanPolygonsPx.forEach(consider);
  buildings.forEach((b) => consider(b.polygonPx));
  roadRingsPx.forEach((r) => consider(r.outer));
  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; maxX = 1000; maxY = 1000;
  }

  return {
    sketchId: sk.id,
    title: sk.title || "Master Plan",
    scale: sk.scale || "1:500",
    pxm,
    mapRotationDeg: ((Number(sk.geo?.mapRotation) || 0) % 360 + 360) % 360,
    boundsPx: { minX, minY, maxX, maxY },
    lahanPolygonsPx,
    lahanInfos,
    totalLahanM2,
    buildings,
    totalFootprintM2,
    totalGfaM2,
    roadRingsPx,
    totalRoadAreaM2,
    kdbKawasanPct: totalLahanM2 > 0 ? ((totalFootprintM2 + totalRoadAreaM2) / totalLahanM2) * 100 : 0,
    illustrations: normalizeAnnotations(sk.illustrations),
    geo: (sk.geo && sk.geo.locked && Number.isFinite(Number(sk.geo.lat)) && Number.isFinite(Number(sk.geo.lon)))
      ? {
          lat: Number(sk.geo.lat),
          lon: Number(sk.geo.lon),
          mapOpacity: Number.isFinite(Number(sk.geo.mapOpacity)) ? Math.max(0, Math.min(1, Number(sk.geo.mapOpacity))) : 0.7,
          mapRotation: Number(sk.geo.mapRotation) || 0,
        }
      : undefined,
  };
}

function ptsToRing(pts: Pt[]): [number, number][] {
  const r: [number, number][] = pts.map((p) => [p.x, p.y]);
  if (r.length > 0) {
    const a = r[0], b = r[r.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  }
  return r;
}

function ringToPts(ring: [number, number][]): Pt[] {
  const out: Pt[] = ring.map(([x, y]) => ({ x, y }));
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (a.x === b.x && a.y === b.y) out.pop();
  }
  return out;
}
