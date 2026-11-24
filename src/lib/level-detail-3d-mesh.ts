// Mesh Three.js bersama untuk kotak Detail 3D (Model 3D) dan slide aksonometri.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { detail3dBottomAt, type Detail3dKind, type Detail3dPrism } from "@/lib/level-detail-3d";

/** Semua jenis dinding (bata, beton, konsep) sama-sama putih di Detail 3D. */
export const DETAIL3D_WALL_COLOR = "#ffffff";
const DETAIL3D_WALL_EDGE = "#4a453f";

export const DETAIL3D_KIND_STYLE: Record<Exclude<Detail3dKind, "floor">, { color: string; opacity?: number; edges?: string }> = {
  wall: { color: DETAIL3D_WALL_COLOR, edges: DETAIL3D_WALL_EDGE },
  parapet: { color: DETAIL3D_WALL_COLOR, edges: DETAIL3D_WALL_EDGE },
  concrete: { color: DETAIL3D_WALL_COLOR, edges: DETAIL3D_WALL_EDGE },
  concept: { color: DETAIL3D_WALL_COLOR, edges: DETAIL3D_WALL_EDGE },
  glass: { color: "#8fc6e0", opacity: 0.38, edges: "#3f7f9c" },
  railing: { color: "#6f7378", edges: "#2a2c2e" },
  frame: { color: "#4a3f36" },
  door: { color: "#a8743f", edges: "#5a3b1c" },
  slab: { color: "#a3a7ad", edges: "#4b4f55" },
  column: { color: "#8f8c86", edges: "#262420" },
  ceiling: { color: "#f7f5f0", edges: DETAIL3D_WALL_EDGE },
  /** Rangka hollow aluminium plafon (khusus Potongan 3D). */
  ceilingFrame: { color: "#9ea4ab", edges: "#5d636a" },
  /** Tangga beton bersama Detail 3D dan Potongan 3D. */
  stair: { color: "#d9d6cf", edges: "#4b4f55" },
};

export function detail3dStyle(kind: Detail3dKind, color?: string) {
  return kind === "floor" ? { color: color ?? "#d6d0c6", edges: "#55504a" as string | undefined, opacity: undefined as number | undefined } : DETAIL3D_KIND_STYLE[kind];
}

/** Plan (x, y) → scene (x - cx, h, y - cy): +y sketsa → +Z scene, sama dengan halaman Model 3D. */
export function detail3dPrismGeometry(prism: Detail3dPrism, cx: number, cy: number): THREE.BufferGeometry | null {
  const depth = prism.top - prism.bottom;
  if (!(depth > 0) || prism.outer.length < 3) return null;
  const shape = new THREE.Shape(prism.outer.map((p) => new THREE.Vector2(p.x - cx, p.y - cy)));
  for (const hole of prism.holes) {
    if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x - cx, p.y - cy))));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.scale(1, -1, 1);
  geo.translate(0, prism.bottom, 0);
  geo.clearGroups();
  if (prism.soffit) {
    // Dasar miring: turunkan/naikkan titik dasar mengikuti pelat tangga.
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - prism.bottom) > 1e-6) continue;
      pos.setY(i, detail3dBottomAt(prism, { x: pos.getX(i) + cx, y: pos.getZ(i) + cy }));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

export type Detail3dMesh = { key: string; kind: Detail3dKind; color?: string; geometry: THREE.BufferGeometry };

export function detail3dMergedMeshes(prisms: Detail3dPrism[], cx: number, cy: number): Detail3dMesh[] {
  const buckets = new Map<string, { kind: Detail3dKind; color?: string; geos: THREE.BufferGeometry[] }>();
  for (const prism of prisms) {
    const key = prism.kind === "floor" ? `floor:${prism.color ?? ""}` : prism.kind;
    const geo = detail3dPrismGeometry(prism, cx, cy);
    if (!geo) continue;
    const bucket = buckets.get(key) ?? { kind: prism.kind, ...(prism.color ? { color: prism.color } : {}), geos: [] };
    bucket.geos.push(geo);
    buckets.set(key, bucket);
  }
  const out: Detail3dMesh[] = [];
  for (const [key, bucket] of buckets) {
    const merged = bucket.geos.length === 1 ? bucket.geos[0]! : mergeGeometries(bucket.geos, false);
    if (merged && merged !== bucket.geos[0]) bucket.geos.forEach((g) => g.dispose());
    if (merged) out.push({ key, kind: bucket.kind, ...(bucket.color ? { color: bucket.color } : {}), geometry: merged });
  }
  return out;
}
