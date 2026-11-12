import { describe, expect, it } from "vitest";
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

describe("volumetric table", () => {
  const t = buildVolumetricTable(levels, layers);
  it("fungsi is coefficient 1 area, MEP is coefficient 0 area", () => {
    const l1 = t.rows.find((r) => r.name === "Lantai 1")!;
    expect(l1.fungsiM2).toBeCloseTo(514.37);
    expect(l1.mepM2).toBeCloseTo(138.85);
    expect(l1.gfaM2).toBeCloseTo(845.31);
    expect(l1.efektifPct).toBeCloseTo(60.85, 2);
  });
  it("volume = GFA × floor height, typical floors expand per copy", () => {
    expect(t.rows.map((r) => r.name)).toEqual(["B1", "Lantai 1", "Level 2", "Level 3", "Lantai Atap"]);
    const l1 = t.rows[1];
    expect(l1.heightM).toBeCloseTo(5.25);
    expect(l1.volumeM3).toBeCloseTo(845.31 * 5.25);
    expect(t.rows[4].elevationM).toBeCloseTo(15.75);
    expect(t.rows[0].heightM).toBeCloseTo(3.5);
  });
  it("CFA adds open/taman area to GFA", () => {
    expect(t.cfaM2).toBeCloseTo(t.gfaM2 + 40);
  });
  it("paginates keeping room for totals on the last page", () => {
    expect(paginateVolumetricRows([1, 2, 3], 5, 2).length).toBe(1);
    expect(paginateVolumetricRows([1, 2, 3, 4, 5], 5, 2)).toEqual([[1, 2, 3, 4], [5]]);
  });
});
