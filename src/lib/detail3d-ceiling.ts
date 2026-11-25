// Plafon opsional untuk kotak Detail 3D (ceklis "Plafon" di halaman Model 3D).
import type { Detail3dInput, Detail3dPrism } from "@/lib/level-detail-3d";
import { section3dCeilings } from "@/lib/section-3d";

/** Plafon level ini, hanya di bawah tapak lantai di atasnya (tanpa lift/shaft/tangga). */
export function detail3dCeilings(input: Detail3dInput): Detail3dPrism[] {
  const above = (input.upperFootprint ?? [])
    .filter((poly) => poly[0] && poly[0].length >= 3)
    .map((poly) => ({ outer: poly[0]!, holes: poly.slice(1), thicknessMm: 150 }));
  if (!above.length) return [];
  return section3dCeilings(input.rooms, above, input.pxPerMeter, Math.max(0.1, Number(input.wallHeight) || 4));
}
