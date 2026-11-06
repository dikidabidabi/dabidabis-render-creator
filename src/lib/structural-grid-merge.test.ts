import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeGridInto, gridAxisSegments, distanceToGrid, DEFAULT_GRID } from "./structural-grid";

test("merge memindahkan semua as + garis Jadikan Grid ke grid aktif", () => {
  const target = { ...DEFAULT_GRID, enabled: true };
  const source = { ...DEFAULT_GRID, enabled: true, origin: { x: 100, y: 0 }, spansX: [5], spansY: [4],
    extraLines: [{ id: "a", origin: { x: 0, y: 0 }, rotation: 0, lengthM: 3 }] };
  const merged = mergeGridInto(target, source, 10);
  assert.equal(merged.extraLines!.length, 2 + 2 + 1);
  const segs = gridAxisSegments(source, 10);
  assert.deepEqual(segs[0].origin, { x: 100, y: 0 });
  assert.equal(segs[0].rotation, 90);
  assert.equal(segs[0].lengthM, 4);
  assert.ok(distanceToGrid(source, { x: 150, y: 20 }, 10) < 1e-9);
});
