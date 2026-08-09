// Fetch OSM road centerlines via Overpass around a geo anchor, returning
// polylines in meter offsets (east/north) plus an estimated carriageway width.
// Used to extrude a thin (10 cm) road slab in the 3D previews.

export type OsmRoad = {
  id: string;
  path: { east: number; north: number }[];
  widthM: number;
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

const WIDTH_BY_TYPE: Record<string, number> = {
  motorway: 14,
  trunk: 12,
  primary: 10,
  secondary: 9,
  tertiary: 8,
  residential: 6,
  unclassified: 6,
  living_street: 5,
  service: 4,
  pedestrian: 4,
};

// Only driveable / meaningful ways — skips footway, path, steps, track, cycleway
// and link stubs, which are the bulk of the payload in dense areas.
const HIGHWAY_FILTER =
  "motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|pedestrian";

const cache = new Map<string, { ts: number; data: OsmRoad[] }>();
const TTL_MS = 60 * 60 * 1000;

async function run(
  key: string,
  lat: number,
  lon: number,
  radiusM: number,
  signal?: AbortSignal,
) {
  return dedupe("r_" + key, async () => {
    const q = `[out:json][timeout:12];way["highway"~"^(${HIGHWAY_FILTER})$"](around:${radiusM},${lat},${lon});out tags geom qt;`;
    const json = await overpassQuery(q, signal);

    const elements: any[] = Array.isArray(json.elements) ? json.elements : [];
    const out: OsmRoad[] = [];
    for (const el of elements) {
      if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
      const tags = el.tags || {};
      const type = String(tags.highway || "");
      let widthM = Number(String(tags.width ?? "").replace(",", "."));
      if (!Number.isFinite(widthM) || widthM <= 0) {
        const lanes = Number(tags.lanes);
        widthM = Number.isFinite(lanes) && lanes > 0 ? lanes * 3.2 : (WIDTH_BY_TYPE[type] ?? 6);
      }
      widthM = Math.max(1.5, Math.min(30, widthM));
      const path = el.geometry.map((g: any) => offsetMeters(lat, lon, Number(g.lat), Number(g.lon)));
      out.push({ id: String(el.id), path, widthM });
    }
    cache.set(key, { ts: Date.now(), data: out });
    writePersisted("r_" + key, out);
    return out;
  });
}

export async function fetchOsmRoads(
  lat: number,
  lon: number,
  radiusM: number,
  signal?: AbortSignal,
): Promise<OsmRoad[]> {
  const { key, radius } = snapKey(lat, lon, radiusM);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;

  const persisted = readPersistedEntry<OsmRoad[]>("r_" + key);
  if (persisted) {
    cache.set(key, { ts: Date.now(), data: persisted.data });
    if (persisted.stale) void run(key, lat, lon, radius).catch(() => {});
    return persisted.data;
  }

  return run(key, lat, lon, radius, signal);
}

/** Warms the cache without rendering. */
export function prefetchOsmRoads(lat: number, lon: number, radiusM: number) {
  void fetchOsmRoads(lat, lon, radiusM).catch(() => {});
}
