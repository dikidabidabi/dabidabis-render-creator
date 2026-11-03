import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detailDimensionVisibility } from "./detail-dimensions";

describe("detail dimension visibility", () => {
  it("defaults both sub-options to active when Dimensi is active", () => {
    assert.deepEqual(detailDimensionVisibility({ dimensions: true }), { grid: true, room: true });
  });
  it("hides grid dimensions independently", () => {
    assert.deepEqual(detailDimensionVisibility({ dimensions: true, gridDimensions: false }), { grid: false, room: true });
  });
  it("hides room dimensions independently", () => {
    assert.deepEqual(detailDimensionVisibility({ dimensions: true, roomDimensions: false }), { grid: true, room: false });
  });
  it("hides both when the master is inactive despite active sub-options", () => {
    assert.deepEqual(detailDimensionVisibility({ dimensions: false, gridDimensions: true, roomDimensions: true }), { grid: false, room: false });
  });
  it("retains individual choices after toggling the master", () => {
    const area = { dimensions: false, gridDimensions: false, roomDimensions: true };
    assert.deepEqual(detailDimensionVisibility({ ...area, dimensions: true }), { grid: false, room: true });
  });
});
import { mergeCrowdedDimensions } from "./detail-dimensions";
test("crowded room dimensions merge shortest segment, keeping grid ends", () => {
  // pxPerM 100, font 10 → digit 6px. 0..300 (3000), 300..320 (200), 320..600
  const merged = mergeCrowdedDimensions([0, 300, 320, 600], [0, 300, 600], { pxPerM: 100, fontSize: 10 });
  expect(merged).toEqual([0, 300, 600]);
});
test("non-crowded room dimensions stay", () => {
  expect(mergeCrowdedDimensions([0, 300, 600], [], { pxPerM: 100, fontSize: 10 })).toEqual([0, 300, 600]);
});
