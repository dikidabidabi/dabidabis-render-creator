// Exporter utilities for the Model 3D page.
// Builds a clean THREE.Group containing only architectural meshes
// (walls/floors/masses) and serializes via official three.js exporters:
//   - OBJExporter  -> Wavefront .obj
//   - GLTFExporter -> Binary glTF (.glb)
//
// Helper objects (grids, cameras, bounding boxes, lights) are intentionally
// excluded from the export.

import * as THREE from "three";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export type Point = { x: number; y: number };

export type MeshInput = {
  name: string;
  points: Point[];      // sketch pixel space
  origin: Point;
  mPerPx: number;
  baseY: number;        // meters (y up)
  height: number;       // meters
  color: string;        // any CSS color
};

function sanitizeName(s: string): string {
  return (s || "mesh").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "mesh";
}

function buildExtrudedMesh(input: MeshInput): THREE.Mesh | null {
  if (input.points.length < 3 || input.height <= 0) return null;
  const shape = new THREE.Shape();
  input.points.forEach((p, i) => {
    const x = (p.x - input.origin.x) * input.mPerPx;
    const y = (p.y - input.origin.y) * input.mPerPx;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: input.height, bevelEnabled: false });
  // Match ExtrudedFloor: rotateX(+π/2), scale(1,-1,1), then translate by baseY
  geo.rotateX(Math.PI / 2);
  geo.scale(1, -1, 1);
  geo.translate(0, input.baseY, 0);
  geo.computeVertexNormals();

  const col = new THREE.Color();
  try { col.set(input.color); } catch { col.setRGB(0.91, 0.36, 0.23); }

  const mat = new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = sanitizeName(input.name);
  return mesh;
}

/**
 * Build a clean THREE.Group containing ONLY architectural meshes.
 * Helpers (grids, cameras, lights, bounding boxes) are never added.
 */
export function buildExportGroup(inputs: MeshInput[], title = "model"): THREE.Group {
  const group = new THREE.Group();
  group.name = sanitizeName(title);
  let i = 0;
  for (const inp of inputs) {
    const m = buildExtrudedMesh(inp);
    if (m) {
      m.name = `${m.name}_${i++}`;
      group.add(m);
    }
  }
  return group;
}

export function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
  });
}

// ----------------- OBJ EXPORTER -----------------

export function exportGroupAsObj(group: THREE.Group): string {
  const exporter = new OBJExporter();
  return exporter.parse(group);
}

// ----------------- GLB EXPORTER -----------------

export async function exportGroupAsGlb(group: THREE.Group): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      group,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error("GLTFExporter did not return binary output"));
      },
      (err) => reject(err),
      { binary: true },
    );
  });
}

// ----------------- DOWNLOAD HELPER -----------------

export function triggerDownload(data: Blob | string | ArrayBuffer | Uint8Array, filename: string, mime: string) {
  let blob: Blob;
  if (data instanceof Blob) blob = data;
  else if (typeof data === "string") blob = new Blob([data], { type: mime });
  else if (data instanceof ArrayBuffer) blob = new Blob([data], { type: mime });
  else blob = new Blob([data.slice().buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
