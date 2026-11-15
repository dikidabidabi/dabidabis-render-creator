import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDxf, buildPlanPrimitives, hatchSegments, type DxfExportInput } from "./dxf-export";
import { edgeMaterialKey } from "./edge-segments";
import { DEFAULT_GRID } from "./structural-grid";

const PPM = 100; // 100 px = 1 m
const L = "lv1";
const base = (over: Partial<DxfExportInput> = {}): DxfExportInput => ({
  pxPerMeter: PPM, levelId: L, lines: [], edgeAttrs: {}, layers: [], doors: [], windows: [], grids: [],
  levels: [{ id: L, mdpl: 0 }], parkingStallsByArea: [], parkingAreas: [], mmGridRotRad: 0, ...over,
});
const wall = (ax: number, ay: number, bx: number, by: number) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, kind: "straight" as const, levelId: L });

function polysOn(prims: ReturnType<typeof buildPlanPrimitives>, layer: string) {
  return prims.filter((p): p is Extract<typeof p, { t: "poly" }> => p.t === "poly" && p.layer === layer);
}
function bboxHeight(pts: { y: number }[]) { const ys = pts.map((p) => p.y); return Math.max(...ys) - Math.min(...ys); }

test("dinding beton 300 mm diekspor setebal 300 mm (bukan 150 mm)", () => {
  const line = wall(0, 0, 500, 0);
  const prims = buildPlanPrimitives(base({ lines: [line], edgeAttrs: { [edgeMaterialKey(L, line.a, line.b)]: "concrete300" } }));
  const outer = polysOn(prims, "WALL-CONCRETE");
  assert.equal(outer.length, 1);
  assert.ok(Math.abs(bboxHeight(outer[0].pts) - 30) < 1e-6);
  const core = polysOn(prims, "WALL-CONCRETE-CORE");
  assert.ok(Math.abs(bboxHeight(core[0].pts) - 27) < 1e-6); // finishing 15 mm tiap sisi
});

test("pintu memotong dinding dan menambah kusen, daun, serta busur", () => {
  const line = wall(0, 0, 500, 0);
  const door = { a: { x: 200, y: 0 }, b: { x: 290, y: 0 }, nx: 0, ny: 1, leaves: 1 as const, widthCm: 90 };
  const prims = buildPlanPrimitives(base({ lines: [line], edgeAttrs: { [edgeMaterialKey(L, line.a, line.b)]: "solid" }, doors: [door] }));
  assert.equal(polysOn(prims, "WALL-SOLID").length, 2); // dinding terbelah oleh bukaan
  assert.equal(prims.filter((p) => p.t === "arc" && p.layer === "DOOR").length, 1);
  assert.equal(polysOn(prims, "DOOR").length, 3); // 2 kusen + 1 daun
});

test("grid struktur menghasilkan kolom dan bubble berlabel", () => {
  const grid = { ...DEFAULT_GRID, enabled: true, spansX: [6], spansY: [6], colSizeCm: 50 };
  const prims = buildPlanPrimitives(base({ grids: [grid] }));
  assert.equal(polysOn(prims, "COLUMN").length, 4);
  const labels = prims.filter((p): p is Extract<typeof p, { t: "text" }> => p.t === "text").map((p) => p.text).sort();
  assert.deepEqual(labels, ["1", "1", "2", "2", "A", "A", "B", "B"]);
  assert.equal(polysOn(prims, "GRID").length, 4);
});

test("jendela memotong dinding dan menggambar kusen", () => {
  const line = wall(0, 0, 500, 0);
  const window = { id: "w", levelId: L, a: { x: 100, y: 0 }, b: { x: 220, y: 0 }, nx: 0, ny: 1, leaves: 2, widthCm: 120 };
  const prims = buildPlanPrimitives(base({ lines: [line], edgeAttrs: { [edgeMaterialKey(L, line.a, line.b)]: "concrete200" }, windows: [window] }));
  assert.equal(polysOn(prims, "WALL-CONCRETE").length, 2);
  assert.equal(polysOn(prims, "WINDOW").length, 3); // 2 kusen + 1 pembatas
});

test("arsir 45° hanya di dalam bidang", () => {
  const square = [[[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]]];
  const segs = hatchSegments(square, 45, 2, [0.5]);
  assert.ok(segs.length > 0);
  for (const [a, b] of segs) for (const p of [a, b]) assert.ok(p.x > -1e-6 && p.x < 10 + 1e-6 && p.y > -1e-6 && p.y < 10 + 1e-6);
});

test("file DXF memuat layer dan linetype grid", () => {
  const dxf = buildDxf(base({ grids: [{ ...DEFAULT_GRID, enabled: true }] }));
  assert.ok(dxf.includes("GRIDCENTER"));
  assert.ok(dxf.includes("\r\nCOLUMN\r\n"));
  assert.ok(dxf.trimEnd().endsWith("EOF"));
});
