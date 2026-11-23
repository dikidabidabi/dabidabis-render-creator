// Tampilan "terang" bersama untuk Potongan 3D dan aksonometri Detail 3D:
// exposure ke arah putih, material doff, dan garis bangunan tipis tegas.
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/** Exposure ke arah putih: warna permukaan dicampur putih agar model terang/bersih. */
export const BRIGHT3D_WHITE_MIX = 0.45;
/** Campuran putih untuk kaca (tetap terbaca kebiruan). */
export const BRIGHT3D_GLASS_MIX = 0.25;
/** Tebal garis bangunan dalam piksel CSS (garis WebGL biasa hanya 1 px fisik). */
export const BRIGHT3D_EDGE_WIDTH = 0.675;
/** Cahaya: ambient tinggi + hemisfer + matahari, bayangan lembut. */
export const BRIGHT3D_LIGHT = { ambient: 1.8, hemisphere: 0.5, sun: 1.5, shadowRadius: 4, shadowIntensity: 0.6, groundShadow: 0.12 } as const;

export function brightenColor(color: string | number, mix: number = BRIGHT3D_WHITE_MIX) {
  return "#" + new THREE.Color(color).lerp(new THREE.Color(0xffffff), mix).getHexString();
}

/** Garis tepi dengan lebar nyata dalam piksel; `width`/`height` = ukuran CSS kanvas. */
export function brightEdgeMaterial(color: string, width: number, height: number) {
  const m = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: BRIGHT3D_EDGE_WIDTH, worldUnits: false });
  m.resolution.set(width, height);
  return m;
}
