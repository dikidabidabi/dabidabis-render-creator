import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeGridInto,
  gridAxisSegments,
  distanceToGrid,
  collectGrids,
  computeAllStructuralStats,
  moveGridLinked,
  rotateGridLinked,
  normalizeGrid,
  unmergeGridChild,
  DEFAULT_GRID,
  type StructuralGrid,
} from "./structural-grid";

const levels = [{ id: "l1", mdpl: 0 }];

test("as grid sumber terbaca untuk pemilihan di kanvas", () => {
  const source = { ...DEFAULT_GRID, enabled: true, origin: { x: 100, y: 0 }, spansX: [5], spansY: [4] };
  const segs = gridAxisSegments(source, 10);
  assert.deepEqual(segs[0].origin, { x: 100, y: 0 });
  assert.equal(segs[0].rotation, 90);
  assert.equal(segs[0].lengthM, 4);
  assert.ok(distanceToGrid(source, { x: 150, y: 20 }, 10) < 1e-9);
});

test("merge menyatukan kolom kedua grid", () => {
  const target: StructuralGrid = { ...DEFAULT_GRID, enabled: true, spansX: [8], spansY: [8] }; // 4 kolom
  const source: StructuralGrid = { ...DEFAULT_GRID, enabled: true, origin: { x: 500, y: 0 }, spansX: [6, 6], spansY: [6] }; // 6 kolom
  const merged = mergeGridInto(target, source);
  assert.equal(computeAllStructuralStats(merged, undefined, levels).totalColumns, 10);
  assert.equal(collectGrids(merged, undefined).length, 2);
});

test("merge berantai membawa grid yang sudah tergabung sebelumnya", () => {
  const a: StructuralGrid = { ...DEFAULT_GRID, enabled: true, spansX: [8], spansY: [8] };
  const b: StructuralGrid = { ...DEFAULT_GRID, enabled: true, origin: { x: 500, y: 0 }, spansX: [8], spansY: [8] };
  const c: StructuralGrid = { ...DEFAULT_GRID, enabled: true, origin: { x: 900, y: 0 }, spansX: [8], spansY: [8] };
  const merged = mergeGridInto(a, mergeGridInto(b, c));
  assert.equal(merged.merged!.length, 2);
  assert.equal(computeAllStructuralStats(merged, undefined, levels).totalColumns, 12);
});

test("menggeser grid induk ikut menggeser grid dan garis yang tergabung", () => {
  const target: StructuralGrid = { ...DEFAULT_GRID, enabled: true, origin: { x: 0, y: 0 },
    extraLines: [{ id: "a", origin: { x: 10, y: 10 }, rotation: 0, lengthM: 3 }] };
  const source: StructuralGrid = { ...DEFAULT_GRID, enabled: true, origin: { x: 500, y: 200 } };
  const moved = moveGridLinked(mergeGridInto(target, source), { x: 30, y: -20 });
  assert.deepEqual(moved.origin, { x: 30, y: -20 });
  assert.deepEqual(moved.merged![0].origin, { x: 530, y: 180 });
  assert.deepEqual(moved.extraLines![0].origin, { x: 40, y: -10 });
});

test("memutar grid induk ikut memutar grid tergabung di sekitar origin induk", () => {
  const target: StructuralGrid = { ...DEFAULT_GRID, enabled: true, origin: { x: 0, y: 0 }, rotation: 0 };
  const source: StructuralGrid = { ...DEFAULT_GRID, enabled: true, origin: { x: 100, y: 0 }, rotation: 10 };
  const rotated = rotateGridLinked(mergeGridInto(target, source), 90);
  const child = rotated.merged![0];
  assert.ok(Math.abs(child.origin.x) < 1e-9);
  assert.ok(Math.abs(child.origin.y - 100) < 1e-9);
  assert.equal(child.rotation, 100);
});

test("grid tergabung tersimpan dan bisa dipisah kembali", () => {
  const target: StructuralGrid = { ...DEFAULT_GRID, enabled: true };
  const source: StructuralGrid = { ...DEFAULT_GRID, enabled: true, origin: { x: 500, y: 0 }, spansX: [6] };
  const restored = normalizeGrid(JSON.parse(JSON.stringify(mergeGridInto(target, source))))!;
  assert.equal(restored.merged!.length, 1);
  assert.deepEqual(restored.merged![0].spansX, [6]);
  const { parent, child } = unmergeGridChild(restored, 0);
  assert.equal(parent.merged, undefined);
  assert.deepEqual(child!.origin, { x: 500, y: 0 });
});
