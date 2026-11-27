import { test } from "node:test";
import assert from "node:assert/strict";
import { boxOutline, editCladingPoint, extrudeClading, cladingFaces, moveClading, type Clading } from "./clading";
import { cladingPlanCut, moveCladingPoints, pasteClading, syncCladingInstances } from "./clading-ops";
const PPM = 100;
const base: Clading = {
  id: "a",
  name: "A",
  levelId: "L1",
  boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 3 } }],
};
let n = 0;
const id = () => `n${++n}`;

test("marquee titik: beberapa titik bergeser bersama", () => {
  const [moved] = moveCladingPoints([base], [{ id: "a", boxIndex: 0, index: 1 }, { id: "a", boxIndex: 0, index: 2 }], 50, 0);
  const pts = boxOutline(moved!.boxes[0]!);
  assert.equal(pts[1]!.x, 150);
  assert.equal(pts[2]!.x, 150);
  assert.equal(pts[0]!.x, 0);
});

test("copy tidak terhubung: edit salinan tidak mengubah sumber", () => {
  const all = pasteClading([base], { items: [base], linked: false }, "L2", PPM, id);
  const copy = all[1]!;
  assert.equal(copy.linkId, undefined);
  assert.equal(copy.levelId, "L2");
  const edited = editCladingPoint(copy, 0, 0, null);
  const synced = syncCladingInstances(all, all.map((c) => (c.id === copy.id ? edited : c)));
  assert.equal(boxOutline(synced[0]!.boxes[0]!).length, 4);
});

test("instance terhubung: edit bentuk satu instance mengubah sumber dan sebaliknya", () => {
  const all = pasteClading([base], { items: [base], linked: true }, "L1", PPM, id);
  const inst = all[1]!;
  assert.equal(inst.linkId, "a");
  assert.equal(all[0]!.linkId, "a");
  // pasted on the same level: shifted by width + 0.5 m
  assert.equal(inst.boxes[0]!.min.x, 150);
  const edited = editCladingPoint(inst, 0, 0, null);
  const synced = syncCladingInstances(all, all.map((c) => (c.id === inst.id ? edited : c)));
  assert.equal(boxOutline(synced[0]!.boxes[0]!).length, 3);
  assert.equal(synced[0]!.boxes[0]!.max.x, 100);
  const face = cladingFaces(synced[0]!.boxes).find((f) => f.axis === "z" && f.sign > 0)!;
  const taller = extrudeClading(synced[0]!, face, 1, PPM);
  const back = syncCladingInstances(synced, synced.map((c) => (c.id === "a" ? taller : c)));
  assert.equal(Math.max(...back[1]!.boxes.map((b) => b.max.z)), 4);
});

test("geser XYZ seluruh instance tidak memindahkan instance lain", () => {
  const all = pasteClading([base], { items: [base], linked: true }, "L2", PPM, id);
  const moved = moveClading(all[0]!, 10, 20, 0.5);
  const synced = syncCladingInstances(all, [moved, all[1]!]);
  assert.equal(synced[1]!.boxes[0]!.min.x, 0);
  assert.equal(synced[1]!.boxes[0]!.min.z, 0);
  assert.equal(synced[0]!.boxes[0]!.min.z, 0.5);
});

test("potongan horizontal denah memuat selubung dan rangka pada bidang potong 1 m", () => {
  const cut = cladingPlanCut([base], PPM);
  assert.ok(cut.skin.length >= 4);
  assert.ok(cut.frame.length > 0);
  const low = cladingPlanCut([{ ...base, boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 0.5 } }] }], PPM);
  assert.equal(low.skin.length, 0);
  assert.equal(low.below.length, 1);
});
