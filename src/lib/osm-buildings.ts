// Fetch OSM building footprints via Overpass API around a given geo point,
// with height derived from `height`, `building:height`, or `building:levels * 4m`.
// Cached in-memory + localStorage (stale-while-revalidate) per snapped key.

export type OsmBuilding = {
  id: string;
  // Node offsets in meters relative to the anchor (east, north).
  ring: { east: number; north: number }[];
  heightM: number;
  levels?: number;
  source: "height" | "levels" | "fallback";
};

import {
  dedupe,
  overpassQuery,
  readPersistedEntry,
  snapKey,
  writePersisted,
} from "./osm-cache";

const R_EARTH = 6378137;


function offsetMeters(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const meanLat = ((fromLat + toLat) / 2) * (Math.PI / 180);
  return { east: dLon * Math.cos(meanLat) * R_EARTH, north: dLat * R_EARTH };
}

function parseHeightTag(v: any): number | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseLevelsTag(v: any): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const cache = new Map<string, { ts: number; data: OsmBuilding[] }>();
const TTL_MS = 60 * 60 * 1000;

async function run(
  key: string,
  lat: number,
  lon: number,
  radiusM: number,
  signal?: AbortSignal,
) {
  return dedupe("b_" + key, async () => {
    const q = `[out:json][timeout:12];way["building"](around:${radiusM},${lat},${lon});out tags geom qt;`;
    const json = await overpassQuery(q, signal);

    const elements: any[] = Array.isArray(json.elements) ? json.elements : [];
    const out: OsmBuilding[] = [];
    for (const el of elements) {
      if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 3) continue;
      const tags = el.tags || {};
      const hDirect = parseHeightTag(tags.height) ?? parseHeightTag(tags["building:height"]);
      const lvls = parseLevelsTag(tags["building:levels"]);
      let heightM: number;
      let source: OsmBuilding["source"];
      if (hDirect != null) {
        heightM = hDirect;
        source = "height";
      } else if (lvls != null) {
        heightM = lvls * 4;
        source = "levels";
      } else {
        heightM = 8; // fallback 2 levels
        source = "fallback";
      }
      // Clamp absurd values.
      heightM = Math.max(2, Math.min(400, heightM));

      const ring = el.geometry.map((g: any) => offsetMeters(lat, lon, Number(g.lat), Number(g.lon)));
      // Deduplicate closing node.
      if (ring.length > 1) {
        const a = ring[0], b = ring[ring.length - 1];
        if (Math.hypot(a.east - b.east, a.north - b.north) < 0.05) ring.pop();
      }
      if (ring.length < 3) continue;

      out.push({
        id: String(el.id),
        ring,
        heightM,
        levels: lvls ?? undefined,
        source,
      });
    }
    cache.set(key, { ts: Date.now(), data: out });
    writePersisted("b_" + key, out);
    return out;
  });
}

export async function fetchOsmBuildings(
  lat: number,
  lon: number,
  radiusM: number,
  signal?: AbortSignal,
): Promise<OsmBuilding[]> {
  const { key, radius } = snapKey(lat, lon, radiusM);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;

  const persisted = readPersistedEntry<OsmBuilding[]>("b_" + key);
  if (persisted) {
    cache.set(key, { ts: Date.now(), data: persisted.data });
    // Stale entries refresh silently in the background.
    if (persisted.stale) void run(key, lat, lon, radius).catch(() => {});
    return persisted.data;
  }

  return run(key, lat, lon, radius, signal);
}

/** Warms the cache without rendering (called as soon as a geo anchor is known). */
export function prefetchOsmBuildings(lat: number, lon: number, radiusM: number) {
  void fetchOsmBuildings(lat, lon, radiusM).catch(() => {});
}
