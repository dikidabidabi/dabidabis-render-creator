import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chainGridLines,
  computeStructuralStats,
  extraLinePath,
  gridAxisSegments,
  insertColumnsInRect,
  moveGridLinked,
  normalizeGrid,
  DEFAULT_GRID,
  type StructuralGrid,
} from "./structural-grid";

const levels = [{ id: "l1", mdpl: 0 }];
const ppm = 10;

test("garis bersambung dengan belokan kurang dari 90° menjadi satu rangkaian", () => {
  const segs = [
    { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    { a: { x: 100, y: 0 }, b: { x: 200, y: 50 } }, // belok ±26.6°
    { a: { x: 300, y: 50 }, b: { x: 200, y: 50 } }, // arah terbalik, belok 26.6° lagi
  ];
  const chain = chainGridLines(segs, 0, 1);
  assert.deepEqual(chain.indices, [0, 1, 2]);
  assert.deepEqual(chain.points, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 50 }, { x: 300, y: 50 }]);
});

test("garis yang berbelok 90° atau lebih tidak ikut tersambung", () => {
  const segs = [
    { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    { a: { x: 100, y: 0 }, b: { x: 100, y: 100 } }, // tepat 90°
    { a: { x: 0, y: 0 }, b: { x: 50, y: -10 } }, // berbalik arah (>90°) di ujung awal
  ];
  const chain = chainGridLines(segs, 0, 1);
  assert.deepEqual(chain.indices, [0]);
});

test("rangkaian tersambung juga ke arah ujung awal garis yang dipilih", () => {
  const segs = [
    { a: { x: -100, y: 0 }, b: { x: 0, y: 0 } },
    { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
  ];
  const chain = chainGridLines(segs, 1, 1);
  assert.deepEqual(chain.indices, [0, 1]);
  assert.deepEqual(chain.points[0], { x: -100, y: 0 });
});

test("garis grid bersambung tetap utuh setelah disimpan dan ikut bergeser", () => {
  const g: StructuralGrid = {
    ...DEFAULT_GRID, enabled: true,
    extraLines: [{ id: "c", origin: { x: 0, y: 0 }, rotation: 0, lengthM: 30, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 50 }] }],
  };
  const restored = normalizeGrid(JSON.parse(JSON.stringify(g)))!;
  assert.equal(restored.extraLines![0].points!.length, 3);
  const moved = moveGridLinked(restored, { x: 10, y: 5 });
  assert.deepEqual(extraLinePath(moved.extraLines![0], ppm)[2], { x: 210, y: 55 });
  // satu garis bersambung → 2 segmen untuk hit-test; buble hanya di ujung luar
  const segs = gridAxisSegments({ ...restored, spansX: [], spansY: [], lineOnly: true }, ppm).slice(-2);
  assert.equal(segs[0].hideEnd, true);
  assert.equal(segs[1].hideStart, true);
});

test("insert kolom menambah kolom di persilangan garis grid dalam area seleksi", () => {
  // Grid garis tunggal horizontal y=0 (0..100 px) + garis vertikal x=50 → 1 persilangan.
  const g: StructuralGrid = {
    ...DEFAULT_GRID, enabled: true, lineOnly: true, spansX: [10], spansY: [],
    extraLines: [{ id: "v", origin: { x: 50, y: -20 }, rotation: 90, lengthM: 4 }],
  };
  assert.equal(computeStructuralStats(g, levels).totalColumns, 0);
  const outside = insertColumnsInRect(g, { x0: 60, y0: -5, x1: 90, y1: 5 }, "l1", ppm);
  assert.equal(outside.added, 0);
  const res = insertColumnsInRect(g, { x0: 40, y0: -5, x1: 60, y1: 5 }, "l1", ppm);
  assert.equal(res.added, 1);
  assert.equal(computeStructuralStats(res.grid, levels).totalColumns, 1);
  // Seleksi ulang tidak menggandakan kolom
  assert.equal(insertColumnsInRect(res.grid, { x0: 40, y0: -5, x1: 60, y1: 5 }, "l1", ppm).added, 0);
});

test("insert kolom mengaktifkan lagi node grid yang dinonaktifkan tanpa menggandakan", () => {
  const g: StructuralGrid = {
    ...DEFAULT_GRID, enabled: true, spansX: [8], spansY: [8],
    perLevel: { l1: { disabledNodes: ["1,1"] } },
  };
  assert.equal(computeStructuralStats(g, levels).totalColumns, 3);
  const res = insertColumnsInRect(g, { x0: -10, y0: -10, x1: 200, y1: 200 }, "l1", ppm);
  assert.equal(res.added, 1);
  assert.equal(res.grid.insertedColumns, undefined);
  assert.equal(computeStructuralStats(res.grid, levels).totalColumns, 4);
});
