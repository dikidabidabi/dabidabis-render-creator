import { test } from "node:test";
import assert from "node:assert/strict";
import { createDetailRectangle, detailCorners, detailLocalBounds, orientDetailSketch, rotateDetailPoint } from "./detail-geometry";
import { edgeMaterialKey } from "./edge-segments";

for (const angle of [0, 30, 45, 90, -30]) test(`detail follows ${angle} degree grid and retains its slide dimensions`, () => {
  const a = rotateDetailPoint({ x: 16, y: 24 }, angle), b = rotateDetailPoint({ x: 176, y: 104 }, angle);
  const area = createDetailRectangle(b, a, angle);
  assert.ok(area);
  const bounds = detailLocalBounds(JSON.parse(JSON.stringify(area)));
  assert.ok(Math.abs(bounds.maxX - bounds.minX - 160) < 1e-8);
  assert.ok(Math.abs(bounds.maxY - bounds.minY - 80) < 1e-8);
  const corners = detailCorners(area);
  assert.ok(Math.abs(Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180 / Math.PI - angle) < 1e-8);
});
test("45 degree square with vertical world diagonal is accepted", () => {
  const area = createDetailRectangle({ x: 0, y: 0 }, rotateDetailPoint({ x: 80, y: 80 }, 45), 45);
  assert.ok(area);
  assert.ok(Math.abs(area.a.x - area.b.x) < 1e-8);
});
test("legacy rectangle retains world orientation", () => {
  assert.deepEqual(detailLocalBounds({ a: { x: 100, y: 80 }, b: { x: 0, y: 0 } }), { minX: 0, minY: 0, maxX: 100, maxY: 80 });
});
test("slide rotation preserves wall material, door normal, furniture, and source geometry", () => {
  const a = { x: 0, y: 0 }, b = { x: 0, y: 80 };
  const sketch = { layers: [{ id: "room", points: [a, b, { x: -80, y: 80 }] }], lines: [{ a, b }], doors: [{ a, b, nx: -1, ny: 0 }], structuralGrid: { origin: a, spansX: [1], spansY: [1] }, edgeAttrs: { [edgeMaterialKey("level", a, b)]: "concrete250" as const }, detailAreas: [{ furniture: [{ id: "f", name: "Meja", imageUrl: "", x: 0, y: 40, width: 10, height: 20, rotation: 90, createdAt: 0 }] }] };
  const before = JSON.stringify(sketch);
  const result = orientDetailSketch(sketch, 90);
  assert.ok(Math.abs(result.lines[0].b.x - 80) < 1e-8);
  assert.equal(result.edgeAttrs[edgeMaterialKey("level", a, { x: 80, y: 0 })], "concrete250");
  assert.ok(Math.abs(result.doors[0].ny - 1) < 1e-8);
  assert.equal(result.detailAreas[0].furniture?.[0].rotation, 0);
  assert.equal(JSON.stringify(sketch), before);
});