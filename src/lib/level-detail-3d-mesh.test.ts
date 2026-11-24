import { test } from "node:test";
import assert from "node:assert/strict";
import { detail3dStyle } from "./level-detail-3d-mesh";

test("semua jenis dinding Detail 3D berwarna putih yang sama", () => {
  for (const kind of ["wall", "concrete", "concept"] as const) {
    assert.equal(detail3dStyle(kind).color, "#ffffff");
  }
});
