import { test } from "node:test";
import assert from "node:assert/strict";
import {
  columnCrossSectionAreaM2,
  columnFootprintPolygon,
  computeStructuralStats,
  normalizeGrid,
  DEFAULT_GRID,
} from "./structural-grid";

test("bentuk kolom bawaan kotak; data lama tanpa bentuk tetap kotak", () => {
  assert.equal(normalizeGrid({ ...DEFAULT_GRID, colShape: undefined })?.colShape, "square");
  assert.equal(normalizeGrid({ ...DEFAULT_GRID, colShape: "circle" })?.colShape, "circle");
});

test("kolom lingkaran memakai angka dimensi sebagai diameter", () => {
  const poly = columnFootprintPolygon({ x: 100, y: 50 }, 40, 0, "circle");
  for (const p of poly) assert.ok(Math.abs(Math.hypot(p.x - 100, p.y - 50) - 20) < 1e-9);
  assert.ok(Math.abs(columnCrossSectionAreaM2({ colSizeCm: 50, colShape: "circle" }) - Math.PI * 0.25 * 0.25) < 1e-12);
});

test("kolom kotak tetap sisi × sisi", () => {
  assert.equal(columnCrossSectionAreaM2({ colSizeCm: 50, colShape: "square" }), 0.25);
  assert.equal(columnFootprintPolygon({ x: 0, y: 0 }, 40, 0, "square").length, 4);
});

test("volume beton kolom lingkaran memakai luas lingkaran", () => {
  const levels = [{ id: "l1", mdpl: 0, typicalHeight: 4 }];
  const base = { ...DEFAULT_GRID, enabled: true, spansX: [8], spansY: [8], colSizeCm: 50 };
  const square = computeStructuralStats({ ...base, colShape: "square" }, levels);
  const circle = computeStructuralStats({ ...base, colShape: "circle" }, levels);
  assert.equal(square.totalColumns, 4);
  assert.ok(Math.abs(square.concreteVolumeM3 - 4 * 0.25 * 4) < 1e-9);
  assert.ok(Math.abs(circle.concreteVolumeM3 - 4 * Math.PI * 0.0625 * 4) < 1e-9);
});
