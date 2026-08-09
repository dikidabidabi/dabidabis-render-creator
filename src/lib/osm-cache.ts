// Shared helpers to make Overpass (OSM) fetches feel fast:
//  - persistent localStorage cache (survives page reloads / route changes)
//  - stale-while-revalidate: stale data is served instantly, refreshed in bg
//  - coordinate/radius snapping so masterplan + 3d model share one cache entry
//  - in-flight de-duplication (masterplan + 3d model asking at once = 1 request)
//  - endpoints raced in parallel instead of sequential fallback with timeouts

const PERSIST_PREFIX = "dabidabis_osm_cache_";
const PERSIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/**
 * Snapped cache key: lat/lon to ~110 m and radius bucketed to 100 m steps, so
 * slightly different anchors/radii (masterplan uses bound*1.8, 3d model 350)
 * still reuse the same cached payload.
 */
export function snapKey(lat: number, lon: number, radiusM: number) {
  const rl = lat.toFixed(3);
  const rn = lon.toFixed(3);
  const rr = Math.max(150, Math.ceil(radiusM / 100) * 100);
  return { key: `${rl}|${rn}|${rr}`, radius: rr };
}

export function readPersisted<T>(key: string): T | null {
  const hit = readPersistedEntry<T>(key);
  return hit && !hit.stale ? hit.data : null;
}

/** Returns cached data even when expired, flagged as stale. */
export function readPersistedEntry<T>(
  key: string,
): { data: T; stale: boolean } | null {
  try {
    const raw = localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; data: T };
    if (!parsed) return null;
    return { data: parsed.data, stale: Date.now() - parsed.ts > PERSIST_TTL_MS };
  } catch {
    return null;
  }
}

export function writePersisted<T>(key: string, data: T) {
  try {
    localStorage.setItem(
      PERSIST_PREFIX + key,
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    /* quota exceeded — cache is best-effort */
  }
}

/** Runs all Overpass mirrors at once and resolves with the first success. */
export async function overpassQuery(
  query: string,
  signal?: AbortSignal,
): Promise<any> {
  const attempts = OVERPASS_ENDPOINTS.map(async (url) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
      signal,
    });
    if (!r.ok) throw new Error(`Overpass ${r.status}`);
    return r.json();
  });
  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error("Overpass unavailable");
  }
}

const inflight = new Map<string, Promise<any>>();

/** De-duplicates identical concurrent fetches by cache key. */
export function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
