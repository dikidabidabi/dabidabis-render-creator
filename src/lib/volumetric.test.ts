import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVolumetricTable, paginateVolumetricRows } from "./volumetric";

const levels = [
  { id: "b", name: "Level 0", mdpl: -3.5 },
  { id: "l1", name: "Lantai 1", mdpl: 0 },
  { id: "t", name: "Level 2", mdpl: 5.25, typicalCount: 2, typicalHeight: 5.25 },
  { id: "atap", name: "Lantai Atap", mdpl: 10.5 },
];
const layers = [
  { name: "Lahan", levelId: "l1", areaM2: 5000 },
  { name: "Gudang", levelId: "b", areaM2: 100, coefficient: 0 },
  { name: "Lobby", levelId: "l1", areaM2: 514.37, coefficient: 1 },
  { name: "Shaft MEP", levelId: "l1", areaM2: 138.85, coefficient: 0 },
  { name: "Koridor", levelId: "l1", areaM2: 192.09, coefficient: 0.5 },
  { name: "Void", levelId: "l1", areaM2: 50 },
  { name: "Taman", levelId: "l1", areaM2: 40 },
  { name: "Kantor", levelId: "t", areaM2: 200, coefficient: 1 },
];
const t = buildVolumetricTable(levels, layers);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≈ ${b}`);

test("fungsi is coefficient 1 area, MEP is coefficient 0 area", () => {
  const l1 = t.rows.find((r) => r.name === "Lantai 1")!;
  close(l1.fungsiM2, 514.37);
  close(l1.mepM2, 138.85);
  close(l1.gfaM2, 845.31);
  close(l1.efektifPct, 60.85);
});

test("volume = GFA × floor height; typical floors expand per copy", () => {
  assert.deepEqual(t.rows.map((r) => r.name), ["B1", "Lantai 1", "Level 2", "Level 3", "Lantai Atap"]);
  close(t.rows[1].heightM, 5.25);
  close(t.rows[1].volumeM3, 845.31 * 5.25);
  close(t.rows[4].elevationM, 15.75);
  close(t.rows[0].heightM, 3.5);
});

test("CFA adds taman area to GFA", () => {
  close(t.cfaM2, t.gfaM2 + 40);
});

test("pagination keeps room for totals on the last page", () => {
  assert.equal(paginateVolumetricRows([1, 2, 3], 5, 2).length, 1);
  assert.deepEqual(paginateVolumetricRows([1, 2, 3, 4, 5], 5, 2), [[1, 2, 3, 4], [5]]);
});
