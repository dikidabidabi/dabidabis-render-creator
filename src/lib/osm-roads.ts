// Fetch OSM road centerlines via Overpass around a geo anchor, returning
// polylines in meter offsets (east/north) plus an estimated carriageway width.
// Used to extrude a thin (10 cm) road slab in the 3D previews.

export type OsmRoad = {
  id: string;
  path: { east: number; north: number }[];
  widthM: number;
};

import { dedupe, overpassQuery, readPersisted, writePersisted } from "./osm-cache";

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
  footway: 2,
  path: 2,
};

const cache = new Map<string, { ts: number; data: OsmRoad[] }>();
const TTL_MS = 15 * 60 * 1000;

export async function fetchOsmRoads(
  lat: number,
  lon: number,
  radiusM: number,
  signal?: AbortSignal,
): Promise<OsmRoad[]> {
  const key = `${lat.toFixed(4)}|${lon.toFixed(4)}|${Math.round(radiusM)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;
  const persisted = readPersisted<OsmRoad[]>("r_" + key);
  if (persisted) {
    cache.set(key, { ts: Date.now(), data: persisted });
    return persisted;
  }

  return dedupe("r_" + key, async () => {
    const q = `[out:json][timeout:20];way["highway"](around:${Math.round(radiusM)},${lat},${lon});out tags geom qt;`;
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

