// Exporter utilities for the Model 3D page.
// Builds geometry per layer/level (matching ExtrudedFloor in model3d.tsx)
// and serializes to either Wavefront .obj (text) or Autodesk .3ds (binary).
//
// Both formats run 100% locally in the browser — no native deps.

import * as THREE from "three";

export type Point = { x: number; y: number };
export type ExportLayer = {
  id: string;
  name: string;
  points: Point[];
  color: string;
  levelId?: string;
};
export type ExportFloor = {
  id: string;
  sourceId: string;
  baseMdpl: number;
  height: number;
};

export type MeshInput = {
  name: string;
  points: Point[];      // in sketch pixel space
  origin: Point;
  mPerPx: number;
  baseY: number;        // meters (y up)
  height: number;       // meters
  color: string;        // any CSS color
};

type RawMesh = {
  name: string;
  // positions in meters, world space (y up)
  vertices: number[];   // flat [x,y,z, x,y,z, ...]
  // triangle indices into vertices (0-based)
  indices: number[];
  color: [number, number, number]; // 0..1
};

function buildExtrudedMesh(input: MeshInput): RawMesh | null {
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

  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  const posAttr = nonIndexed.getAttribute("position") as THREE.BufferAttribute;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    vertices.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    indices.push(i);
  }
  geo.dispose();
  if (nonIndexed !== geo) nonIndexed.dispose();

  const col = new THREE.Color();
  try { col.set(input.color); } catch { col.setRGB(0.91, 0.36, 0.23); }

  return {
    name: sanitizeName(input.name),
    vertices,
    indices,
    color: [col.r, col.g, col.b],
  };
}

function sanitizeName(s: string): string {
  return (s || "mesh").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "mesh";
}

export function buildMeshes(inputs: MeshInput[]): RawMesh[] {
  const out: RawMesh[] = [];
  let i = 0;
  for (const inp of inputs) {
    const m = buildExtrudedMesh(inp);
    if (m) { m.name = `${m.name}_${i++}`; out.push(m); }
  }
  return out;
}

// ----------------- OBJ EXPORTER -----------------

export function meshesToObj(meshes: RawMesh[], title = "model"): { obj: string; mtl: string; mtlName: string } {
  const mtlName = `${sanitizeName(title)}.mtl`;
  const objLines: string[] = [];
  const mtlLines: string[] = [];
  objLines.push(`# Dabidabi's model export`);
  objLines.push(`mtllib ${mtlName}`);

  let vOffset = 1; // OBJ is 1-indexed
  meshes.forEach((m, idx) => {
    const matName = `mat_${idx}`;
    mtlLines.push(`newmtl ${matName}`);
    mtlLines.push(`Kd ${m.color[0].toFixed(4)} ${m.color[1].toFixed(4)} ${m.color[2].toFixed(4)}`);
    mtlLines.push(`Ka 0.1 0.1 0.1`);
    mtlLines.push(`Ks 0.05 0.05 0.05`);
    mtlLines.push(`d 1`);
    mtlLines.push(`illum 2`);
    mtlLines.push("");

    objLines.push(`o ${m.name}`);
    objLines.push(`usemtl ${matName}`);
    for (let i = 0; i < m.vertices.length; i += 3) {
      objLines.push(`v ${m.vertices[i].toFixed(6)} ${m.vertices[i + 1].toFixed(6)} ${m.vertices[i + 2].toFixed(6)}`);
    }
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = m.indices[i] + vOffset;
      const b = m.indices[i + 1] + vOffset;
      const c = m.indices[i + 2] + vOffset;
      objLines.push(`f ${a} ${b} ${c}`);
    }
    vOffset += m.vertices.length / 3;
  });

  return { obj: objLines.join("\n"), mtl: mtlLines.join("\n"), mtlName };
}

// ----------------- 3DS EXPORTER -----------------
// Minimal Autodesk 3DS binary writer. Supports per-mesh vertices, faces, and
// a flat diffuse material per mesh. Sufficient for import in most DCC tools.

function asciiZ(s: string): Uint8Array {
  const safe = s.replace(/[^\x20-\x7e]/g, "_").slice(0, 31);
  const out = new Uint8Array(safe.length + 1);
  for (let i = 0; i < safe.length; i++) out[i] = safe.charCodeAt(i) & 0x7f;
  out[safe.length] = 0;
  return out;
}

class ChunkWriter {
  private parts: Uint8Array[] = [];
  private len = 0;
  write(b: Uint8Array) { this.parts.push(b); this.len += b.length; }
  writeU16(n: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n & 0xffff, true);
    this.write(b);
  }
  writeI16(n: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, n, true);
    this.write(b);
  }
  writeU32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    this.write(b);
  }
  writeF32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, n, true);
    this.write(b);
  }
  writeAsciiZ(s: string) { this.write(asciiZ(s)); }
  finalize(id: number): Uint8Array {
    const body = concat(this.parts);
    const total = 6 + body.length;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, id & 0xffff, true);
    dv.setUint32(2, total >>> 0, true);
    out.set(body, 6);
    return out;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function chunk(id: number, ...children: Uint8Array[]): Uint8Array {
  const w = new ChunkWriter();
  for (const c of children) w.write(c);
  return w.finalize(id);
}

function color24(r: number, g: number, b: number): Uint8Array {
  const w = new ChunkWriter();
  w.write(new Uint8Array([
    Math.max(0, Math.min(255, Math.round(r * 255))),
    Math.max(0, Math.min(255, Math.round(g * 255))),
    Math.max(0, Math.min(255, Math.round(b * 255))),
  ]));
  return w.finalize(0x0011);
}

function materialChunk(name: string, color: [number, number, number]): Uint8Array {
  const nameChunk = (() => { const w = new ChunkWriter(); w.writeAsciiZ(name); return w.finalize(0xA000); })();
  const diffuse = chunk(0xA020, color24(color[0], color[1], color[2]));
  return chunk(0xAFFF, nameChunk, diffuse);
}

function verticesChunk(verts: number[]): Uint8Array {
  const count = verts.length / 3;
  const w = new ChunkWriter();
  w.writeU16(count);
  for (let i = 0; i < verts.length; i += 3) {
    w.writeF32(verts[i]);       // x
    w.writeF32(verts[i + 2]);   // y(3ds) = z(scene)
    w.writeF32(verts[i + 1]);   // z(3ds) = y(scene)
  }
  return w.finalize(0x4110);
}

function facesChunk(indices: number[], matName: string): Uint8Array {
  const faceCount = indices.length / 3;
  const w = new ChunkWriter();
  w.writeU16(faceCount);
  for (let i = 0; i < indices.length; i += 3) {
    w.writeU16(indices[i]);
    w.writeU16(indices[i + 1]);
    w.writeU16(indices[i + 2]);
    w.writeU16(0x0007); // all edges visible
  }
  const mat = new ChunkWriter();
  mat.writeAsciiZ(matName);
  mat.writeU16(faceCount);
  for (let i = 0; i < faceCount; i++) mat.writeU16(i);
  const matSub = mat.finalize(0x4130);
  w.write(matSub);
  return w.finalize(0x4120);
}

function objectChunk(name: string, verts: number[], indices: number[], matName: string): Uint8Array {
  const nameBytes = asciiZ(name);
  const mesh = chunk(0x4100, verticesChunk(verts), facesChunk(indices, matName));
  const body = concat([nameBytes, mesh]);
  const out = new Uint8Array(6 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0x4000, true);
  dv.setUint32(2, out.length, true);
  out.set(body, 6);
  return out;
}

function splitMesh(m: RawMesh, maxVerts = 65000): RawMesh[] {
  if (m.vertices.length / 3 <= maxVerts) return [m];
  const out: RawMesh[] = [];
  let part = 0;
  let curVerts: number[] = [];
  let curIdx: number[] = [];
  let map = new Map<number, number>();
  const flush = () => {
    if (!curIdx.length) return;
    out.push({ name: `${m.name}_p${part++}`, vertices: curVerts, indices: curIdx, color: m.color });
    curVerts = []; curIdx = []; map = new Map();
  };
  for (let i = 0; i < m.indices.length; i += 3) {
    const tri = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
    const remapped: number[] = [];
    for (const orig of tri) {
      let n = map.get(orig);
      if (n === undefined) {
        if (curVerts.length / 3 >= maxVerts) { flush(); }
        n = curVerts.length / 3;
        curVerts.push(m.vertices[orig * 3], m.vertices[orig * 3 + 1], m.vertices[orig * 3 + 2]);
        map.set(orig, n);
      }
      remapped.push(n);
    }
    curIdx.push(remapped[0], remapped[1], remapped[2]);
  }
  flush();
  return out;
}

export function meshesTo3ds(meshes: RawMesh[]): Uint8Array {
  const version = (() => { const w = new ChunkWriter(); w.writeU32(3); return w.finalize(0x0002); })();
  const matChildren: Uint8Array[] = [];
  const objChildren: Uint8Array[] = [];
  meshes.forEach((m, idx) => {
    const matName = `mat_${idx}`.slice(0, 16);
    matChildren.push(materialChunk(matName, m.color));
    for (const part of splitMesh(m)) {
      objChildren.push(objectChunk(part.name, part.vertices, part.indices, matName));
    }
  });
  const edit = chunk(0x3D3D, ...matChildren, ...objChildren);
  const main = chunk(0x4D4D, version, edit);
  return main;
}

export function triggerDownload(data: Blob | string | Uint8Array, filename: string, mime: string) {
  let blob: Blob;
  if (data instanceof Blob) blob = data;
  else if (typeof data === "string") blob = new Blob([data], { type: mime });
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
