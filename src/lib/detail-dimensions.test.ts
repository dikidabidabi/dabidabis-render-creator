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