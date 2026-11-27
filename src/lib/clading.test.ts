import { test } from "node:test";
import assert from "node:assert/strict";
import { cladingPrisms, extrudeClading, mergeClading, type Clading } from "./clading";
import { clipPrismsToSection, section3dFrame } from "./section-3d";
const PPM = 100;
const box = (x0: number, x1: number): Clading["boxes"][number] => ({ min: { x: x0, y: 0, z: 0 }, max: { x: x1, y: 100, z: 1 } });
test("clading berdekatan menyatu dan memakai nama clading terbesar", () => {
  const merged = mergeClading([{ id: "a", name: "Kecil", levelId: "L", boxes: [box(0, 100)] }, { id: "b", name: "Besar", levelId: "L", boxes: [box(101, 400)] }], PPM);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.name, "Besar");
});
test("selubung 2 cm dan rangka hollow 4x4 cm", () => {
  const prisms = cladingPrisms([{ id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] }], PPM, 0);
  const top = prisms.find((p) => p.kind === "clading" && p.bottom > 0.9);
  assert.ok(top && Math.abs(top.top - top.bottom - 0.02) < 1e-9);
  const tubes = prisms.filter((p) => p.kind === "cladingFrame");
  assert.ok(tubes.length > 0);
  const zs = tubes.flatMap((p) => [p.bottom, p.top]);
  assert.ok(Math.abs(Math.max(...zs) - Math.min(...zs)) <= 1);
});
test("extrude bidang menambah volume dan clading tetap terpotong", () => {
  const item: Clading = { id: "a", name: "C", levelId: "L", boxes: [box(0, 100)] };
  const next = extrudeClading(item, { box: item.boxes[0]!, axis: "z", sign: 1 }, 0.5, PPM);
  assert.equal(Math.max(...next.boxes.map((b) => b.max.z)), 1.5);
  const frame = section3dFrame({ x: 50, y: -50 }, { x: 50, y: 150 }, PPM);
  assert.ok(frame);
  assert.ok(clipPrismsToSection(cladingPrisms([next], PPM, 0), frame).some((p) => p.kind === "clading"));
});
