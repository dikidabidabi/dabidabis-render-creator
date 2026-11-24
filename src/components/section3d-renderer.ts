// Render Potongan 3D (perspektif satu titik hilang, tegak lurus bidang potong)
// ke PNG transparan. Bayangan matahari 45° jatuh dari kiri-depan ke dalam ruang
// yang terbelah. Bidang potong (poché) digambar sebagai SVG di atas gambar,
// memakai fungsi project yang dikembalikan.
import * as THREE from "three";
import type { Detail3dKind, Detail3dPrism } from "@/lib/level-detail-3d";
import { DETAIL3D_KIND_STYLE, detail3dPrismGeometry } from "@/lib/level-detail-3d-mesh";
import type { Section3dFrame } from "@/lib/section-3d";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { BRIGHT3D_GLASS_MIX, BRIGHT3D_LIGHT, BRIGHT3D_WHITE_MIX, brightEdgeMaterial, brightenColor } from "@/components/bright-3d-look";

export function brightenSection3dColor(color: string, mix = BRIGHT3D_WHITE_MIX) {
  return brightenColor(color, mix);
}

export type Section3dPalette = { floor: string; wall: string; structure: string; cut: string; edge: string; shadow: string };
export type Section3dPart = { key: string; prisms: Detail3dPrism[]; bases: number[] };
export type Section3dRender = { dataUrl: string; project: (x: number, y: number, h: number) => { x: number; y: number } };

/** Prisma bersama dicerminkan (skala y −1) sehingga urutan segitiganya terbalik;
 *  kembalikan agar sisi luar menjadi sisi depan dan normalnya tidak dibalik saat diterangi. */
function fixWinding(geo: THREE.BufferGeometry) {
  const attrs = Object.values(geo.attributes) as THREE.BufferAttribute[];
  if (geo.index) {
    const idx = geo.index;
    for (let i = 0; i + 2 < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
    idx.needsUpdate = true;
    return;
  }
  for (const attr of attrs) {
    const size = attr.itemSize;
    for (let i = 0; i + 2 < attr.count; i += 3) for (let k = 0; k < size; k++) {
      const t = attr.getComponent(i + 1, k);
      attr.setComponent(i + 1, k, attr.getComponent(i + 2, k));
      attr.setComponent(i + 2, k, t);
    }
    attr.needsUpdate = true;
  }
}

function colorFor(kind: Detail3dKind, palette: Section3dPalette) {
  switch (kind) {
    case "floor": return { color: palette.floor, edges: palette.edge as string | undefined, opacity: undefined as number | undefined };
    case "wall": case "concept": case "ceiling": return { color: palette.wall, edges: palette.edge, opacity: undefined };
    case "concrete": case "column": case "slab": case "stair": return { color: palette.structure, edges: palette.edge, opacity: undefined };
    // Rangka hollow plafon hanya 2–4 cm di atas papan 5 mm: garis tepinya akan tembus
    // papan (polygon offset), jadi cukup bidang berarsir; siluet potongnya tetap bergaris.
    case "ceilingFrame": return { color: DETAIL3D_KIND_STYLE.ceilingFrame.color, edges: undefined, opacity: undefined };
    default: return DETAIL3D_KIND_STYLE[kind];
  }
}

export function renderSection3d(parts: Section3dPart[], frame: Section3dFrame, palette: Section3dPalette, width: number, height: number): Section3dRender | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minH = Infinity, maxH = -Infinity;
  for (const part of parts) for (const prism of part.prisms) for (const p of prism.outer) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    for (const base of part.bases) { minH = Math.min(minH, base + prism.bottom); maxH = Math.max(maxH, base + prism.top); }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minH)) return null;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const toScene = (x: number, y: number, h: number) => new THREE.Vector3(x - cx, h, y - cy);

  // Rentang s (sepanjang garis potong) model yang tersisa.
  let minS = Infinity, maxS = -Infinity, maxD = 0;
  for (const part of parts) for (const prism of part.prisms) for (const p of prism.outer) {
    const rx = p.x - frame.a.x, ry = p.y - frame.a.y;
    const s = rx * frame.u.x + ry * frame.u.y, d = rx * frame.n.x + ry * frame.n.y;
    minS = Math.min(minS, s); maxS = Math.max(maxS, s); maxD = Math.max(maxD, d);
  }
  const widthS = Math.max(2, maxS - minS);
  const totalH = Math.max(2, maxH - minH);
  const reach = Math.max(widthS, totalH, maxD, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  const disposables: Array<{ dispose: () => void }> = [];
  try {
    renderer.setPixelRatio(2);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    // Exposure tinggi ke arah putih; bayangan 45° doff (datar, lembut, tanpa kilap).
    scene.add(new THREE.AmbientLight(0xffffff, BRIGHT3D_LIGHT.ambient));
    scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(brightenSection3dColor(palette.shadow, 0.7)), BRIGHT3D_LIGHT.hemisphere));

    // Matahari 45°: datang dari kiri-depan pengamat (kiri gambar = +u), elevasi 45°.
    const lh = new THREE.Vector2(frame.u.x - frame.n.x, frame.u.y - frame.n.y).normalize();
    const mid = toScene(frame.a.x + frame.u.x * (minS + maxS) / 2 + frame.n.x * maxD / 2, frame.a.y + frame.u.y * (minS + maxS) / 2 + frame.n.y * maxD / 2, minH + totalH / 2);
    const sun = new THREE.DirectionalLight(0xffffff, BRIGHT3D_LIGHT.sun);
    const R = reach * 3;
    sun.position.set(mid.x + lh.x * R, mid.y + R, mid.z + lh.y * R);
    sun.target.position.copy(mid);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = BRIGHT3D_LIGHT.shadowRadius;
    sun.shadow.intensity = BRIGHT3D_LIGHT.shadowIntensity;
    Object.assign(sun.shadow.camera, { left: -reach * 1.2, right: reach * 1.2, top: reach * 1.2, bottom: -reach * 1.2, near: 0.1, far: R * 3 });
    scene.add(sun);

    const material = new Map<string, THREE.Material>();
    const matFor = (kind: Detail3dKind) => {
      const style = colorFor(kind, palette);
      const key = `${kind}`;
      let m = material.get(key);
      if (!m) {
        const transparent = style.opacity !== undefined;
        // Doff: Lambert tanpa pantulan spekular, warna dicerahkan ke arah putih.
        m = new THREE.MeshLambertMaterial({
          color: brightenSection3dColor(style.color, kind === "glass" ? BRIGHT3D_GLASS_MIX : BRIGHT3D_WHITE_MIX),
          transparent, opacity: style.opacity ?? 1, depthWrite: !transparent, side: transparent ? THREE.DoubleSide : THREE.FrontSide,
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        });
        material.set(key, m);
        disposables.push(m);
      }
      return { material: m, style };
    };
    // Garis bangunan tegas namun tipis: lebar nyata dalam piksel, warna tepi penuh.
    const edgeMat = brightEdgeMaterial(palette.edge, width, height);
    disposables.push(edgeMat);

    for (const part of parts) {
      const buckets = new Map<Detail3dKind, THREE.BufferGeometry[]>();
      for (const prism of part.prisms) {
        const geo = detail3dPrismGeometry(prism, cx, cy);
        if (!geo) continue;
        fixWinding(geo);
        const arr = buckets.get(prism.kind) ?? [];
        arr.push(geo);
        buckets.set(prism.kind, arr);
      }
      for (const [kind, geos] of buckets) {
        const geo = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
        if (geo !== geos[0]) geos.forEach((g) => g.dispose());
        if (!geo) continue;
        disposables.push(geo);
        const { material: m, style } = matFor(kind);
        let edgesGeo: LineSegmentsGeometry | null = null;
        if (style.edges) {
          const raw = new THREE.EdgesGeometry(geo, 25);
          edgesGeo = new LineSegmentsGeometry().fromEdgesGeometry(raw);
          raw.dispose();
          disposables.push(edgesGeo);
        }
        for (const base of part.bases) {
          const mesh = new THREE.Mesh(geo, m);
          mesh.position.y = base;
          mesh.castShadow = style.opacity === undefined;
          mesh.receiveShadow = true;
          scene.add(mesh);
          if (edgesGeo) {
            const lines = new LineSegments2(edgesGeo, edgeMat);
            lines.position.y = base;
            scene.add(lines);
          }
        }
      }
    }
    const groundGeo = new THREE.PlaneGeometry(reach * 8, reach * 8);
    const groundMat = new THREE.ShadowMaterial({ opacity: BRIGHT3D_LIGHT.groundShadow, color: new THREE.Color(palette.shadow) });
    disposables.push(groundGeo, groundMat);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(mid.x, minH - 0.01, mid.z);
    ground.receiveShadow = true;
    scene.add(ground);

    // Kamera perspektif satu titik hilang: tegak lurus bidang potong, titik
    // hilang sedikit kiri dari tengah dan di bawah setengah tinggi (seperti referensi).
    const sEye = minS + widthS * 0.6;
    const D = Math.max(widthS, totalH) * 1.05;
    const eye = toScene(frame.a.x + frame.u.x * sEye - frame.n.x * D, frame.a.y + frame.u.y * sEye - frame.n.y * D, minH + totalH * 0.45);
    const camera = new THREE.PerspectiveCamera(50, width / height, Math.max(0.05, D * 0.3), D + reach * 6);
    camera.position.copy(eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(eye.clone().add(new THREE.Vector3(frame.n.x, 0, frame.n.y)));
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    const v = new THREE.Vector3();
    for (const part of parts) for (const prism of part.prisms) for (const p of prism.outer) for (const base of part.bases) for (const h of [prism.bottom, prism.top]) {
      v.copy(toScene(p.x, p.y, base + h)).applyMatrix4(inv);
      if (v.z > -1e-3) continue;
      const pu = v.x / -v.z, pv = v.y / -v.z;
      minU = Math.min(minU, pu); maxU = Math.max(maxU, pu); minV = Math.min(minV, pv); maxV = Math.max(maxV, pv);
    }
    if (!Number.isFinite(minU)) return null;
    // Margin: kiri lebih lebar untuk label lantai.
    let w = maxU - minU, hh = maxV - minV;
    minU -= w * 0.16; maxU += w * 0.04; minV -= hh * 0.05; maxV += hh * 0.05;
    w = maxU - minU; hh = maxV - minV;
    const aspect = width / height;
    if (w / hh < aspect) { const extra = hh * aspect - w; minU -= extra / 2; maxU += extra / 2; }
    else { const extra = w / aspect - hh; minV -= extra / 2; maxV += extra / 2; }
    const near = camera.near;
    camera.projectionMatrix.makePerspective(minU * near, maxU * near, maxV * near, minV * near, near, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");
    const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const project = (x: number, y: number, h: number) => {
      const q = toScene(x, y, h).applyMatrix4(viewProj);
      return { x: ((q.x + 1) / 2) * width, y: ((1 - q.y) / 2) * height };
    };
    return { dataUrl, project };
  } finally {
    disposables.forEach((d) => d.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
