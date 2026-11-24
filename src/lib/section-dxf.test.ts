import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeMaterialKey } from "./edge-segments";
import { buildSectionDxf } from "./section-dxf";

const PPM = 100;
const pts: Array<[number, number, number, number]> = [[0, 0, 500, 0], [500, 0, 500, 400], [500, 400, 0, 400], [0, 400, 0, 0]];
const lines = pts.map(([a, b, c, d]) => ({ a: { x: a, y: b }, b: { x: c, y: d }, levelId: "L1" }));
const edgeAttrs = Object.fromEntries(lines.map((l) => [edgeMaterialKey("L1", l.a, l.b), "solid"]));
const sketch: any = { lines, edgeAttrs, layers: [{ name: "Kamar", points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }], levelId: "L1" }], levels: [{ id: "L1", name: "LT 1", mdpl: 0 }], doors: [], windows: [] };

test("DXF potongan memuat dinding terpotong ber-hatch dalam block terpisah", () => {
  const dxf = buildSectionDxf(sketch, { p1: { x: -100, y: 200 }, p2: { x: 600, y: 200 }, label: "A" }, PPM);
  assert.ok(dxf.includes("POTONG-DINDING"));
  assert.ok(dxf.includes("POTONG-PELAT"));
  assert.ok((dxf.match(/\r\nHATCH\r\n/g) ?? []).length >= 2);
  assert.ok(dxf.includes("POTONGAN A"));
});
