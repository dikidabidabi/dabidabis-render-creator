import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCladingPoint,
  boxOutline,
  cladingFaces,
  cladingPrisms,
  cladingVolume,
  editCladingPoint,
  extrudeClading,
  extrudeCladingFaces,
  mergeClading,
  normalizeClading,
  snapCladingDistance,
  type Clading,
} from "./clading";
import { sameSide, segmentFaces } from "./clading-solid";
import { clipPrismsToSection, section3dFrame } from "./section-3d";
const PPM = 100;
const box = (x0: number, x1: number): Clading["boxes"][number] => ({
  min: { x: x0, y: 0, z: 0 },
  max: { x: x1, y: 100, z: 1 },
});
test("clading berdekatan menyatu dan memakai nama clading terbesar", () => {
  const merged = mergeClading(
    [
      { id: "a", name: "Kecil", levelId: "L", boxes: [box(0, 100)] },
      { id: "b", name: "Besar", levelId: "L", boxes: [box(101, 400)] },
    ],
    PPM,
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.name, "Besar");
});
test("selubung 2 cm dan rangka hollow 4x4 cm", () => {
  const prisms = cladingPrisms(
    [{ id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] }],
    PPM,
    0,
  );
  const top = prisms.find((p) => p.kind === "clading" && p.bottom > 0.9);
  assert.ok(top && Math.abs(top.top - top.bottom - 0.02) < 1e-9);
  const tubes = prisms.filter((p) => p.kind === "cladingFrame");
  assert.ok(tubes.length > 0);
  const zs = tubes.flatMap((p) => [p.bottom, p.top]);
  assert.ok(Math.abs(Math.max(...zs) - Math.min(...zs)) <= 1);
});
test("extrude bidang menambah volume dan clading tetap terpotong", () => {
  const item: Clading = { id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] };
  const first = item.boxes[0];
  assert.ok(first);
  const next = extrudeClading(item, { box: first, axis: "z", sign: 1 }, 0.5, PPM);
  assert.equal(Math.max(...next.boxes.map((b) => b.max.z)), 1.5);
  const frame = section3dFrame({ x: 50, y: -50 }, { x: 50, y: 150 }, PPM);
  assert.ok(frame);
  assert.ok(
    clipPrismsToSection(cladingPrisms([next], PPM, 0), frame).some((p) => p.kind === "clading"),
  );
});
test("hapus satu titik box menghasilkan segitiga, tetap tersimpan dan muncul di 3D", () => {
  const item: Clading = { id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] };
  const triangle = editCladingPoint(item, 0, 0, null),
    first = triangle.boxes[0];
  assert.ok(first);
  assert.equal(boxOutline(first).length, 3);
  assert.equal(cladingVolume(triangle), 5000);
  assert.equal(
    normalizeClading(JSON.parse(JSON.stringify([triangle])))[0]?.boxes[0]?.points?.length,
    3,
  );
  const top = cladingPrisms([triangle], PPM, 0).find(
    (p) => p.kind === "clading" && Math.abs(p.top - 1) < 1e-9 && Math.abs(p.bottom - 0.98) < 1e-9,
  );
  assert.ok(top);
  assert.equal(top.outer.length, 3);
});
test("geser X/Y titik membuat trapesium dan rangka mengikuti sisi miring", () => {
  const item: Clading = { id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] };
  const trapezoid = editCladingPoint(item, 0, 0, { x: 20, y: 10 }),
    first = trapezoid.boxes[0];
  assert.ok(first);
  assert.deepEqual(boxOutline(first)[0], { x: 20, y: 10 });
  assert.ok(
    cladingFaces(trapezoid.boxes).some(
      (f) => f.normal && Math.abs(f.normal.x) > 0.01 && Math.abs(f.normal.y) > 0.01,
    ),
  );
  assert.ok(
    cladingPrisms([trapezoid], PPM, 0).some(
      (p) => p.kind === "cladingFrame" && p.outer.some((v) => v.x !== 0 && v.x !== 1),
    ),
  );
});
test("titik dapat ditambah, minimum tiga titik dan poligon berpotongan ditolak", () => {
  const item: Clading = { id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] };
  assert.equal(
    boxOutline(addCladingPoint(item, 0, 0, { x: 50, y: 0 }).boxes[0] ?? box(0, 100)).length,
    5,
  );
  const triangle = editCladingPoint(item, 0, 0, null);
  assert.equal(editCladingPoint(triangle, 0, 0, null), triangle);
  assert.equal(editCladingPoint(item, 0, 0, { x: 150, y: 50 }), item);
});
test("multi-segmen hanya satu sisi dan ekstrusi mengubah semua segmen terpilih", () => {
  const item: Clading = { id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] };
  const face = cladingFaces(item.boxes).find((f) => f.edge && f.axis === "x" && f.sign === 1);
  assert.ok(face);
  const segments = segmentFaces(face, PPM);
  assert.equal(segments.length, 4);
  const a = segments[0],
    b = segments[1];
  assert.ok(a && b);
  assert.equal(sameSide(a, b), true);
  const opposite = cladingFaces(item.boxes).find((f) => f.axis === "x" && f.sign === -1);
  assert.ok(opposite);
  assert.equal(sameSide(a, opposite), false);
  const next = extrudeCladingFaces(item, [a, b], 0.2, PPM);
  assert.equal(Math.max(...next.boxes.map((b) => b.max.x)), 120);
  assert.equal(next.boxes.length, 3);
});
test("snap ekstrusi memakai blok grid sketsa, bukan langkah tetap 5 cm", () => {
  const ppm100 = 80,
    ppm200 = 40,
    ppm500 = 16;
  assert.equal(snapCladingDistance(0.26, 8 / ppm100), 0.30000000000000004);
  assert.equal(snapCladingDistance(0.26, 8 / ppm200), 0.2);
  assert.equal(snapCladingDistance(0.26, 8 / ppm500), 0.5);
  assert.equal(snapCladingDistance(-0.26, 8 / ppm200), -0.2);
});
test("extrude sisi miring mengikuti normal bidang dan bukan sumbu box", () => {
  const item: Clading = { id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] };
  const triangle = editCladingPoint(item, 0, 0, null);
  const face = cladingFaces(triangle.boxes).find(
    (f) => f.edge && f.normal && Math.abs(f.normal.x) > 0.1 && Math.abs(f.normal.y) > 0.1,
  );
  assert.ok(face && face.normal && face.edge);
  const next = extrudeClading(triangle, face, 0.2, PPM),
    part = next.boxes.at(-1);
  assert.ok(part);
  const points = boxOutline(part),
    last = points[3];
  assert.ok(last);
  assert.ok(Math.abs(last.x - face.edge.a.x - face.normal.x * 20) < 1e-8);
  assert.ok(Math.abs(last.y - face.edge.a.y - face.normal.y * 20) < 1e-8);
  assert.ok(cladingPrisms([next], PPM, 0).some((p) => p.kind === "clading"));
});
test("extrude negatif di tengah bidang tidak mengisi ulang lubang", () => {
  const item: Clading = { id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] };
  const next = extrudeClading(
    item,
    { axis: "z", sign: 1, box: { min: { x: 25, y: 25, z: 0 }, max: { x: 75, y: 75, z: 1 } } },
    -0.5,
    PPM,
  );
  assert.equal(cladingVolume(next), 8750);
  const faces = cladingFaces(next.boxes).filter(
    (f) => f.axis === "z" && f.sign === 1 && f.box.max.z === 1,
  );
  const area = faces.reduce(
    (sum, f) =>
      sum +
      Math.abs(
        (f.polygon ?? []).reduce((a, p, i, ring) => {
          const q = ring[(i + 1) % ring.length];
          return a + (q ? p.x * q.y - q.x * p.y : 0);
        }, 0) / 2,
      ),
    0,
  );
  assert.equal(area, 7500);
});
