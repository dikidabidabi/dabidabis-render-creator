import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDetailSection, detailSectionEnabled, detailSectionGridHits, detailSectionHatch, detailSectionElevation, detailSectionFloorDatum, type DetailSectionSketch } from "./detail-section";
import { DEFAULT_GRID, gridLocalToWorld } from "./structural-grid";
import { edgeMaterialKey } from "./edge-segments";

const square = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }];
const cut = { p1: { x: -100, y: 200 }, p2: { x: 600, y: 200 } };
const lines = square.map((p, i) => ({ a: p, b: square[(i + 1) % square.length] ?? p, levelId: "a" }));
const sketch: DetailSectionSketch = {
  levels: [{ id: "a", name: "Lantai 1", mdpl: 0 }, { id: "b", name: "Lantai 2", mdpl: 4 }],
  layers: [{ id: "r", name: "Kantor", levelId: "a", points: square, ceilingHeightM: 2.8 }],
  lines,
  edgeAttrs: Object.fromEntries(lines.map(l => [edgeMaterialKey("a", l.a, l.b), "solid"])),
  floors: [{ levelId: "a", outer: square, thicknessMm: 150 }, { levelId: "b", outer: square, thicknessMm: 150 }],
  clading: [{ id: "c", name: "Clading", levelId: "a", boxes: [{ min: { x: 100, y: 100, z: 0 }, max: { x: 300, y: 300, z: 3 } }] }],
  structuralGrid: { ...DEFAULT_GRID, enabled: true, spansX: [2.5, 2.5], spansY: [4] },
};
test("detail potongan bawaan nonaktif dan hanya aktif pada ceklis true", () => {
  assert.equal(detailSectionEnabled(cut), false);
  assert.equal(detailSectionEnabled({ ...cut, showDetailSlide: false }), false);
  assert.equal(detailSectionEnabled({ ...cut, showDetailSlide: true }), true);
});
test("grid potongan mengikuti rotasi dan dimensi bentang 2,5 m", () => {
  const grid = { ...DEFAULT_GRID, enabled: true, rotation: 30, spansX: [2.5, 2.5], spansY: [4] };
  const rotated = { p1: gridLocalToWorld(grid, -1, 2, 100), p2: gridLocalToWorld(grid, 6, 2, 100) };
  const hits = detailSectionGridHits([grid], rotated, 100);
  assert.equal(hits.length, 3);
  assert.ok(Math.abs((hits[1]?.s ?? 0) - (hits[0]?.s ?? 0) - 2.5) < 1e-6);
});
test("potongan menampilkan plafon 2,8 m dan dimensi lantai 4 m", () => {
  const result = buildDetailSection(sketch, cut, 100);
  assert.ok(result);
  assert.ok(result.groups.some(g => g.kind === "ceiling"));
  assert.ok(result.ceilingDimensions.some(d => d.head - d.base === 2.8));
  assert.deepEqual(result.floors.map(f => f.base), [0, 4]);
});
test("tanpa plafon menghapus papan, rangka, dan dimensi tinggi plafon", () => {
  const result = buildDetailSection({ ...sketch, layers: [{ ...sketch.layers?.[0], name: "Kantor", points: square, levelId: "a", ceilingHeightM: null }] }, cut, 100);
  assert.ok(result);
  assert.equal(result.groups.some(g => g.kind === "ceiling" || g.kind === "ceilingFrame"), false);
  assert.equal(result.ceilingDimensions.length, 0);
});
test("potongan menyertakan selubung dan rangka clading serta balok 70 cm", () => {
  const result = buildDetailSection(sketch, cut, 100);
  assert.ok(result);
  assert.ok(result.groups.some(g => g.kind === "clading"));
  assert.ok(result.groups.some(g => g.kind === "cladingFrame"));
  assert.ok(result.beyond.some(p => p.kind === "slab" && Math.abs(p.top - p.bottom - 0.7) < 1e-6));
});
test("hatch dinding berbeda dari beton, clading tidak memakai hatch beton", () => {
  assert.equal(detailSectionHatch("wall"), "wall");
  assert.equal(detailSectionHatch("concrete"), "concrete");
  assert.equal(detailSectionHatch("column"), "concrete");
  assert.equal(detailSectionHatch("clading"), null);
});
test("AFF mengukur tinggi plafon dari muka lantai ruang, bukan datum bangunan", () => {
  assert.equal(detailSectionElevation(12.3, 9.5), 2.8);
  assert.equal(detailSectionElevation(8.5, 9.5), -1);
});
test("FFL lantai dasar nol, lantai atas positif dan basemen negatif", () => {
  const datum = detailSectionFloorDatum([{ name: "Basemen", base: 96.5 }, { name: "Lantai Dasar", base: 100 }, { name: "Lantai 2", base: 109.5 }]);
  assert.equal(datum, 100);
  assert.deepEqual([96.5, 100, 109.5].map(base => detailSectionElevation(base, datum)), [-3.5, 0, 9.5]);
});
test("ruang terpotong mendapat posisi nama dan FFL; ruang di luar potongan tidak diberi label", () => {
  const result = buildDetailSection({ ...sketch, layers: [...(sketch.layers ?? []), { id: "outside", name: "Ruang luar", levelId: "a", points: square.map(p => ({ x: p.x, y: p.y + 500 })) }] }, cut, 100);
  assert.ok(result);
  assert.deepEqual(result.rooms.map(room => ({ name: room.name, ffl: room.ffl, s0: room.s0, s1: room.s1 })), [{ name: "Kantor", ffl: 0, s0: 1, s1: 6 }]);
});