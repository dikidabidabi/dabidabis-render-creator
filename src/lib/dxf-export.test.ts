import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDxf, buildPlanPrimitives, encodeDxf, hatchSegments, type DxfExportInput } from "./dxf-export";
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

// ---- Block, hatch, dan teks ruang ----
const solidWall = wall(0, 0, 500, 0);
const sampleDxf = () => buildDxf(base({
  lines: [solidWall],
  edgeAttrs: { [edgeMaterialKey(L, solidWall.a, solidWall.b)]: "solid" },
  doors: [{ a: { x: 200, y: 0 }, b: { x: 290, y: 0 }, nx: 0, ny: 1, leaves: 1 as const, widthCm: 90 }],
  windows: [{ id: "w", levelId: L, a: { x: 350, y: 0 }, b: { x: 470, y: 0 }, nx: 0, ny: 1, leaves: 2, widthCm: 120 }],
  grids: [{ ...DEFAULT_GRID, enabled: true, spansX: [6], spansY: [6], colSizeCm: 50 }],
  layers: [{ name: "R. Tamu", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }], areaM2: 12.5 }],
}));
/** Pasangan (kode grup, nilai) dari teks DXF. */
const tagsOf = (dxf: string) => { const l = dxf.split("\r\n"); const out: Array<[string, string]> = []; for (let i = 0; i + 1 < l.length; i += 2) out.push([l[i].trim(), l[i + 1]]); return out; };
/** Jenis entitas di dalam definisi block bernama. */
function blockEntityTypes(dxf: string, name: string): string[] {
  const tags = tagsOf(dxf);
  const start = tags.findIndex(([g, v], i) => g === "0" && v === "BLOCK" && tags.slice(i, i + 12).some(([gg, vv]) => gg === "2" && vv === name));
  if (start < 0) return [];
  const types: string[] = [];
  for (let i = start + 1; i < tags.length && !(tags[i][0] === "0" && tags[i][1] === "ENDBLK"); i++) if (tags[i][0] === "0") types.push(tags[i][1]);
  return types;
}

test("file DXF ditulis sebagai R2000 agar mendukung HATCH dan block", () => {
  assert.ok(sampleDxf().includes("$ACADVER\r\n1\r\nAC1015"));
});

test("dinding menjadi block DINDING dengan notasi arsir HATCH", () => {
  const types = blockEntityTypes(sampleDxf(), "DINDING");
  assert.ok(types.includes("HATCH"));
  assert.ok(!types.includes("LINE")); // arsir tidak lagi berupa garis lepas
  assert.ok(sampleDxf().includes("DABI_DINDING"));
});

test("grid dan bubble-nya berada dalam satu block GRID", () => {
  const types = blockEntityTypes(sampleDxf(), "GRID");
  assert.ok(types.includes("LWPOLYLINE") && types.includes("CIRCLE") && types.includes("TEXT"));
});

test("setiap pintu dan jendela menjadi block sendiri yang di-INSERT", () => {
  const dxf = sampleDxf();
  assert.ok(blockEntityTypes(dxf, "PINTU-01").includes("ARC"));
  assert.ok(blockEntityTypes(dxf, "JENDELA-01").length > 0);
  const inserts = tagsOf(dxf).filter(([, v], i, all) => v === "INSERT" && all[i][0] === "0").length;
  assert.equal(inserts, 5); // DINDING, KOLOM, PINTU-01, JENDELA-01, GRID
});

test("nama dan luas ruang ditulis sebagai TEXT CAD", () => {
  const texts = tagsOf(sampleDxf()).filter(([g], i, all) => g === "1" && all.slice(Math.max(0, i - 12), i).some(([gg, vv]) => gg === "0" && vv === "TEXT")).map(([, v]) => v);
  assert.ok(texts.includes("R. Tamu"));
  assert.ok(texts.includes("12,50 m²"));
});

test("simbol m² dikodekan satu byte ANSI_1252, huruf lain sebagai \\U+", () => {
  assert.deepEqual([...encodeDxf("m²")], [0x6d, 0xb2]);
  assert.deepEqual([...encodeDxf("—")], [0x97]);
  assert.equal(new TextDecoder().decode(encodeDxf("Ω")), "\\U+03A9");
});
