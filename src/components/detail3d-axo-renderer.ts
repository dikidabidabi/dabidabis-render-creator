// Render aksonometri Detail 3D (satu atau beberapa lantai bertumpuk) ke PNG
// dengan kamera ortografik. Dipakai slide Detail 3D per level dan slide
// Detail Aksonometri agar tampilan dan pencahayaannya sama.
import * as THREE from "three";
import type { Detail3dModel } from "@/lib/level-detail-3d";
import { detail3dMergedMeshes, detail3dStyle } from "@/lib/level-detail-3d-mesh";

export const DETAIL3D_VIEW_DIR = new THREE.Vector3(0.7, 1.1, 0.9).normalize(); // sama dengan kotak Detail 3D

export type AxoPart = { model: Detail3dModel; /** Elevasi dasar (m) di susunan. */ base: number };
/** Titik 3D: denah (x, y) meter, h = tinggi di susunan. */
export type AxoPoint = { id: string; x: number; y: number; h: number };
export type AxoProjected = { id: string; x: number; y: number };
export type AxoRender = { dataUrl: string; points: AxoProjected[] };

export function renderDetail3dAxo(parts: AxoPart[], points: AxoPoint[], width: number, height: number): AxoRender | null {
  let minPX = Infinity, minPY = Infinity, maxPX = -Infinity, maxPY = -Infinity, topH = 0;
  for (const { model, base } of parts) {
    const b = model.bounds;
    if (!b) continue;
    minPX = Math.min(minPX, b.minX); minPY = Math.min(minPY, b.minY);
    maxPX = Math.max(maxPX, b.maxX); maxPY = Math.max(maxPY, b.maxY);
    topH = Math.max(topH, base + model.wallHeight);
  }
  if (!Number.isFinite(minPX)) return null;
  const cx = (minPX + maxPX) / 2, cy = (minPY + maxPY) / 2;
  const span = Math.max(4, maxPX - minPX, maxPY - minPY);
  const reach = Math.max(span, topH);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  const disposables: Array<{ dispose: () => void }> = [];
  try {
    renderer.setPixelRatio(2);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#ffffff");
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc9c2b8, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(span * 0.8, topH + span * 1.8, span * 1.1);
    sun.target.position.set(0, topH / 2, 0);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -reach * 1.5, right: reach * 1.5, top: reach * 1.5, bottom: -reach * 1.5, near: 0.1, far: reach * 8 });
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-span, topH + span, -span * 0.6);
    scene.add(fill);

    for (const { model, base } of parts) {
      for (const m of detail3dMergedMeshes(model.prisms, cx, cy)) {
        const style = detail3dStyle(m.kind, m.color);
        const transparent = style.opacity !== undefined;
        const material = new THREE.MeshStandardMaterial({
          color: style.color,
          roughness: m.kind === "glass" ? 0.1 : 0.75,
          metalness: m.kind === "glass" ? 0.1 : 0.02,
          transparent,
          opacity: style.opacity ?? 1,
          depthWrite: !transparent,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(m.geometry, material);
        mesh.position.y = base;
        mesh.castShadow = !transparent;
        mesh.receiveShadow = true;
        scene.add(mesh);
        disposables.push(m.geometry, material);
        if (style.edges) {
          const edgeGeo = new THREE.EdgesGeometry(m.geometry, 20);
          const edgeMat = new THREE.LineBasicMaterial({ color: style.edges });
          const edges = new THREE.LineSegments(edgeGeo, edgeMat);
          edges.position.y = base;
          scene.add(edges);
          disposables.push(edgeGeo, edgeMat);
        }
      }
    }
    const groundGeo = new THREE.PlaneGeometry(span * 4, span * 4);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.16 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = Math.min(0, ...parts.map((p) => p.base)) - 0.16;
    ground.receiveShadow = true;
    scene.add(ground);
    disposables.push(groundGeo, groundMat);

    // Kamera ortografik (aksonometri), dipaskan ke seluruh titik model.
    const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.01, reach * 60);
    camera.position.copy(DETAIL3D_VIEW_DIR).multiplyScalar(reach * 15);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const v = new THREE.Vector3();
    for (const { model, base } of parts) for (const prism of model.prisms) for (const p of prism.outer) for (const h of [prism.bottom, prism.top]) {
      v.set(p.x - cx, base + h, p.y - cy).applyMatrix4(inv);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    if (!Number.isFinite(minX)) return null;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    camera.position.addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2);
    camera.zoom = Math.min(width / Math.max(1e-3, maxX - minX), height / Math.max(1e-3, maxY - minY)) * 0.92;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");
    const projected = points.map(({ id, x, y, h }) => {
      v.set(x - cx, h, y - cy).project(camera);
      return { id, x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
    });
    return { dataUrl, points: projected };
  } finally {
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
