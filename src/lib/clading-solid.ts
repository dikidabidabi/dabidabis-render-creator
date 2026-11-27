import clipping from "polygon-clipping";
import type { CladingBox, CladingFace } from "./clading";

export type CladingPoint = { x: number; y: number };
type Ring = CladingPoint[];
const pcRing = (ring: Ring): clipping.Ring => ring.map((p) => [p.x, p.y]);
export function boxOutline(box: CladingBox): Ring {
  return box.points ?? [{ x: box.min.x, y: box.min.y }, { x: box.max.x, y: box.min.y }, { x: box.max.x, y: box.max.y }, { x: box.min.x, y: box.max.y }];
}
export function ringArea(ring: Ring): number {
  return ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + (q ? p.x * q.y - q.x * p.y : 0); }, 0) / 2;
}
export function validOutline(points: Ring): boolean {
  if (points.length < 3 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || Math.abs(ringArea(points)) < 0.001) return false;
  const cross = (a: CladingPoint, b: CladingPoint, c: CladingPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 0.001) return false;
    for (let j = i + 2; j < points.length; j++) {
      if ((j + 1) % points.length === i) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (c && d && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 && Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x)) <= Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x)) && Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)) <= Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))) return false;
    }
  }
  return true;
}
export function outlineBox(points: Ring, bottom: number, top: number): CladingBox {
  return { min: { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)), z: bottom }, max: { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)), z: top }, points };
}
export function clipOutline(a: Ring, b: Ring, subtract = false): Ring[] {
  const result = subtract ? clipping.difference([pcRing(a)], [pcRing(b)]) : clipping.intersection([pcRing(a)], [pcRing(b)]);
  return result.flatMap((poly) => { const ring = poly[0]; if (!ring) return []; const points = ring.map(([x,y]) => ({x,y})); if (points.length > 1) points.pop(); return Math.abs(ringArea(points)) > 1e-9 ? [points] : []; });
}
/** Exposed union surfaces, including sloping polygon edges. Horizontal union holes
 * are decomposed into cells only when needed, preserving hollow interiors. */
export function solidFaces(boxes: CladingBox[]): CladingFace[] {
  const levels = [...new Set(boxes.flatMap((b) => [b.min.z, b.max.z]))].sort((a,b) => a-b);
  const layers = levels.slice(0,-1).map((z,i) => {
    const top = levels[i+1] ?? z;
    const polys = boxes.filter((b) => b.min.z <= z && b.max.z >= top).map((b) => [pcRing(boxOutline(b))] as clipping.Polygon);
    return { z, top, union: polys.length ? clipping.union(polys[0] ?? [], ...polys.slice(1)) : [] as clipping.MultiPolygon };
  });
  const faces: CladingFace[] = [];
  const horizontal = (polys: clipping.MultiPolygon, z: number, top: number, sign: 1 | -1) => {
    for (const poly of polys) {
      const first = poly[0]; if (!first) continue;
      // Clip into vertical strips at every vertex when a polygon has holes.
      const xs = poly.length > 1 ? [...new Set(poly.flatMap((r) => r.map((p) => p[0])))].sort((a,b) => a-b) : [];
      const parts = xs.length ? xs.slice(0,-1).flatMap((x,i) => {
        const X = xs[i+1]; if (X === undefined) return [];
        const ys = poly.flatMap((r) => r.map((p) => p[1]));
        return clipping.intersection(poly, [[[x, Math.min(...ys)-1], [X, Math.min(...ys)-1], [X, Math.max(...ys)+1], [x, Math.max(...ys)+1]]]);
      }) : [poly];
      for (const part of parts) { const outer = part[0]; if (!outer) continue; const points = outer.slice(0,-1).map(([x,y]) => ({x,y})); if (points.length < 3) continue; faces.push({ box: outlineBox(points,z,top), axis: "z", sign, polygon: points }); }
    }
  };
  for (let i=0;i<layers.length;i++) {
    const layer = layers[i]; if (!layer || layer.top <= layer.z) continue;
    const previous = layers[i-1]?.union ?? [], next = layers[i+1]?.union ?? [];
    horizontal(previous.length ? clipping.difference(layer.union, previous) : layer.union, layer.z, layer.top, -1);
    horizontal(next.length ? clipping.difference(layer.union, next) : layer.union, layer.z, layer.top, 1);
    for (const poly of layer.union) for (let r=0;r<poly.length;r++) {
      const ring = poly[r]?.slice(0,-1).map(([x,y]) => ({x,y})); if (!ring) continue;
      const orientation = (ringArea(ring) >= 0 ? 1 : -1) * (r === 0 ? 1 : -1);
      ring.forEach((a,j) => {
        const b=ring[(j+1)%ring.length]; if (!b) return;
        const length=Math.hypot(b.x-a.x,b.y-a.y); if (!length) return;
        const normal={ x: orientation*(b.y-a.y)/length, y: -orientation*(b.x-a.x)/length };
        const axis = Math.abs(normal.x) >= Math.abs(normal.y) ? "x" : "y";
        faces.push({ box: { min:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),z:layer.z},max:{x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),z:layer.top} },axis,sign:normal[axis]>=0?1:-1,edge:{a,b},normal });
      });
    }
  }
  return faces;
}
export function segmentFaces(face: CladingFace, ppm: number): CladingFace[] {
  const pitch=0.5*ppm;
  if (face.edge) {
    const {a,b}=face.edge, length=Math.hypot(b.x-a.x,b.y-a.y), faces:CladingFace[]=[];
    for(let t=0;t<length-1e-7;t+=pitch) for(let z=face.box.min.z;z<face.box.max.z-1e-7;z+=0.5){
      const u={x:a.x+(b.x-a.x)*t/length,y:a.y+(b.y-a.y)*t/length},v={x:a.x+(b.x-a.x)*Math.min(length,t+pitch)/length,y:a.y+(b.y-a.y)*Math.min(length,t+pitch)/length};
      faces.push({...face,edge:{a:u,b:v},box:{min:{x:Math.min(u.x,v.x),y:Math.min(u.y,v.y),z},max:{x:Math.max(u.x,v.x),y:Math.max(u.y,v.y),z:Math.min(z+0.5,face.box.max.z)}}});
    }
    return faces;
  }
  const faces:CladingFace[]=[];
  for(let x=face.box.min.x;x<face.box.max.x-1e-7;x+=pitch) for(let y=face.box.min.y;y<face.box.max.y-1e-7;y+=pitch){
    const rectangle=[{x,y},{x:x+pitch,y},{x:x+pitch,y:y+pitch},{x,y:y+pitch}];
    for(const polygon of clipOutline(face.polygon??boxOutline(face.box),rectangle)) faces.push({...face,polygon,box:outlineBox(polygon,face.box.min.z,face.box.max.z)});
  }
  return faces;
}
export function sameSide(a:CladingFace,b:CladingFace):boolean {
  if(a.edge && b.edge && a.normal && b.normal) return Math.abs(a.normal.x-b.normal.x)<1e-6 && Math.abs(a.normal.y-b.normal.y)<1e-6 && Math.abs(a.normal.x*(a.edge.a.x-b.edge.a.x)+a.normal.y*(a.edge.a.y-b.edge.a.y))<1e-5;
  return !a.edge && !b.edge && a.axis===b.axis && a.sign===b.sign && Math.abs((a.sign>0?a.box.max.z:a.box.min.z)-(b.sign>0?b.box.max.z:b.box.min.z))<1e-6;
}