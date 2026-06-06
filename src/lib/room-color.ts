// Deterministic color per room name.
// Same full name (including digits) → same color across sketch, plan, section, 3D.
// Different name → different hue (well-distributed via golden-angle).
//
// Returned format mirrors the legacy LAYER_COLORS template so callers can do
// `color.replace("ALPHA", "0.32")` exactly as before.

function normalizeName(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// FNV-1a 32-bit
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  // h in [0,360), s/l in [0,1]
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; b = 0; }
  else if (hp < 2) { r = x; g = c; b = 0; }
  else if (hp < 3) { r = 0; g = c; b = x; }
  else if (hp < 4) { r = 0; g = x; b = c; }
  else if (hp < 5) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const m = l - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

const GOLDEN = 137.508; // golden angle in degrees for good hue separation

/**
 * Returns rgba string with ALPHA placeholder, e.g. "rgba(231, 96, 58, ALPHA)".
 * Returns null when name is empty so callers can fall back to stored color.
 */
export function colorForRoomName(name: string | undefined | null): string | null {
  const n = normalizeName(name ?? "");
  if (!n) return null;
  const h = hashString(n);
  // Distribute hues via golden angle, but seeded by hash so order doesn't matter.
  const hue = (h * GOLDEN) % 360;
  // Slight variations in saturation/lightness for additional separation.
  const sat = 0.62 + ((h >>> 8) & 0xff) / 255 * 0.18; // 0.62..0.80
  const lig = 0.50 + ((h >>> 16) & 0xff) / 255 * 0.10; // 0.50..0.60
  const [r, g, b] = hslToRgb(hue, sat, lig);
  return `rgba(${r}, ${g}, ${b}, ALPHA)`;
}

/** Same as colorForRoomName but returns a solid CSS color (no ALPHA) suitable for THREE. */
export function solidColorForRoomName(name: string | undefined | null, fallback = "#e85d3a"): string {
  const c = colorForRoomName(name);
  if (!c) return fallback;
  return c.replace("ALPHA", "1");
}
