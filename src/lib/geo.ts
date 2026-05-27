// Shared geographic helpers used by sketch canvas, 3D model (SunCalc), and
// presentation slides. The Sketch.geo object is the single source of truth.

export type Geo = {
  lat: number;
  lon: number;
  locked: boolean;
  mapOpacity: number; // 0..1
  label?: string;
};

export const DEFAULT_GEO: Geo = {
  lat: -6.2,
  lon: 106.816666,
  locked: false,
  mapOpacity: 0.55,
  label: "",
};

// --- Web Mercator math ---
// One px at zoom z at latitude lat (meters / pixel)
export function metersPerMapPx(lat: number, z: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
}

export function lonLatToTile(lon: number, lat: number, z: number) {
  const n = Math.pow(2, z);
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function tileToLonLat(x: number, y: number, z: number) {
  const n = Math.pow(2, z);
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lon, lat: (latRad * 180) / Math.PI };
}

// World->geo conversions assume world(0,0) is anchored on geo (lat,lon).
// `worldPxPerMeter` is the canvas's px/m derived from current sketch scale.
export function geoOffsetToWorld(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  worldPxPerMeter: number,
) {
  const R = 6378137;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const meanLat = ((fromLat + toLat) / 2) * (Math.PI / 180);
  const dx = dLon * Math.cos(meanLat) * R;
  const dy = -dLat * R; // canvas y grows downward, north is up → negative
  return { x: dx * worldPxPerMeter, y: dy * worldPxPerMeter };
}

// Pick best integer tile zoom so that meters-per-tile-pixel ≈ desired.
// Tiles will then be scaled by `k` when drawn to compensate residuals.
export function pickTileZoom(lat: number, worldPxPerMeter: number) {
  // desired mpp = 1 / worldPxPerMeter
  const desired = 1 / worldPxPerMeter;
  const raw = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / desired);
  return Math.max(0, Math.min(19, Math.round(raw)));
}

// --- Nominatim search (free, no API key) ---
export type NominatimHit = {
  display_name: string;
  lat: string;
  lon: string;
};
export async function nominatimSearch(q: string, limit = 6): Promise<NominatimHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error("Nominatim error");
  return (await r.json()) as NominatimHit[];
}

// --- Tile cache (shared across components) ---
const tileCache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

export function getTile(
  z: number,
  x: number,
  y: number,
  onLoad?: () => void,
): HTMLImageElement | null {
  const k = `${z}/${x}/${y}`;
  const cached = tileCache.get(k);
  if (cached && cached.complete && cached.naturalWidth > 0) return cached;
  if (pending.has(k)) return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => {
      tileCache.set(k, img);
      pending.delete(k);
      resolve(img);
      onLoad?.();
    };
    img.onerror = (e) => {
      pending.delete(k);
      reject(e);
    };
  });
  pending.set(k, p);
  // Subdomain rotation reduces rate-limit impact.
  const sub = ["a", "b", "c"][(x + y) % 3];
  img.src = `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
  return null;
}

// Draw OSM tiles into a 2D canvas covering the given world bounds.
// World units are in CANVAS pixels (i.e. before the camera scale `s`),
// anchored so that geo(lat,lon) maps to world(0,0).
export function drawOsmTiles(
  ctx: CanvasRenderingContext2D,
  opts: {
    lat: number;
    lon: number;
    worldPxPerMeter: number;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    opacity: number;
    onTileLoad?: () => void;
    grayscale?: boolean;
  },
) {
  const { lat, lon, worldPxPerMeter, bounds, opacity, onTileLoad, grayscale } = opts;
  const z = pickTileZoom(lat, worldPxPerMeter);
  const mpp = metersPerMapPx(lat, z);
  // World px per map-tile px:
  const k = worldPxPerMeter * mpp;
  const tileSize = 256 * k;
  const center = lonLatToTile(lon, lat, z);
  // Tile (tx, ty) top-left corner in world coords:
  // world(centerTile.x, centerTile.y) origin is at geo (lat,lon)
  // so tile coord T maps to world x = (T - center.x) * tileSize
  const tx0 = Math.floor(bounds.minX / tileSize + center.x);
  const ty0 = Math.floor(bounds.minY / tileSize + center.y);
  const tx1 = Math.ceil(bounds.maxX / tileSize + center.x);
  const ty1 = Math.ceil(bounds.maxY / tileSize + center.y);

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  if (grayscale) (ctx as any).filter = "grayscale(100%) contrast(0.95) brightness(1.05)";
  const maxT = Math.pow(2, z);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const wrappedX = ((tx % maxT) + maxT) % maxT;
      if (ty < 0 || ty >= maxT) continue;
      const img = getTile(z, wrappedX, ty, onTileLoad);
      const wx = (tx - center.x) * tileSize;
      const wy = (ty - center.y) * tileSize;
      if (img) {
        ctx.drawImage(img, wx, wy, tileSize, tileSize);
      } else {
        // placeholder
        ctx.fillStyle = "rgba(200,200,200,0.35)";
        ctx.fillRect(wx, wy, tileSize, tileSize);
      }
    }
  }
  ctx.restore();
}
