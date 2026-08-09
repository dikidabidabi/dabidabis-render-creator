// Fetch OSM building footprints via Overpass API around a given geo point,
// with height derived from `height`, `building:height`, or `building:levels * 4m`.
// Cached in-memory per rounded coordinate + radius.

export type OsmBuilding = {
  id: string;
  // Node offsets in meters relative to the anchor (east, north).
  ring: { east: number; north: number }[];
  heightM: number;
  levels?: number;
  source: "height" | "levels" | "fallback";
};

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
const TTL_MS = 15 * 60 * 1000;

function cacheKey(lat: number, lon: number, radiusM: number) {
  const rl = (lat).toFixed(4);
  const rn = (lon).toFixed(4);
  return `${rl}|${rn}|${Math.round(radiusM)}`;
}

export async function fetchOsmBuildings(
  lat: number,
  lon: number,
  radiusM: number,
  signal?: AbortSignal,
): Promise<OsmBuilding[]> {
  const key = cacheKey(lat, lon, radiusM);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;

  const q = `[out:json][timeout:25];(way["building"](around:${Math.round(radiusM)},${lat},${lon}););out body geom;`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  let json: any = null;
  let lastErr: unknown = null;
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
        signal,
      });
      if (!r.ok) throw new Error(`Overpass ${r.status}`);
      json = await r.json();
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!json) throw (lastErr instanceof Error ? lastErr : new Error("Overpass unavailable"));

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
  return out;
}
