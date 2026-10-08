import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { roomWallSpans } from "./room-wall-spans";

const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
const lines = points.map((a, index) => ({ a, b: points[(index + 1) % points.length], levelId: "L1" }));
const total = (input: typeof lines) => roomWallSpans(points, input, "L1").reduce((sum, span) => sum + span.length, 0);

describe("actual lined room perimeter", () => {
  test("full perimeter and wall surface", () => {
    assert.equal(total(lines), 14);
    assert.equal(total(lines) * 3, 42);
  });
  test("open side is excluded from symbols and area", () => {
    const spans = roomWallSpans(points, lines.slice(1), "L1");
    assert.equal(spans.some((span) => span.sideIndex === 0), false);
    assert.equal(total(lines.slice(1)) * 3, 30);
  });
  test("partial side counts only lined spans and places symbols there", () => {
    const partial = [...lines.slice(1), { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, levelId: "L1" },
      { a: { x: 3, y: 0 }, b: { x: 4, y: 0 }, levelId: "L1" }];
    assert.equal(total(partial), 12);
    assert.deepEqual(roomWallSpans(points, partial, "L1").filter((span) => span.sideIndex === 0).map((span) => (span.a.x + span.b.x) / 2), [0.5, 3.5]);
  });
  test("duplicate, reversed and overlapping lines never double-count", () => {
    assert.equal(total([...lines, { ...lines[0], a: lines[0].b, b: lines[0].a },
      { a: { x: 1, y: 0 }, b: { x: 3, y: 0 }, levelId: "L1" }]), 14);
  });
  test("other levels, crossing and parallel nearby lines do not close an open side", () => {
    assert.equal(total([...lines.slice(1), { ...lines[0], levelId: "L2" },
      { a: { x: 2, y: -1 }, b: { x: 2, y: 1 }, levelId: "L1" },
      { a: { x: 0, y: 0.1 }, b: { x: 4, y: 0.1 }, levelId: "L1" }]), 10);
  });
  test("no lines never implies a wall", () => { assert.equal(total([]), 0); });
  test("short lined intervals still contribute area", () => {
    assert.ok(Math.abs(total([{ a: { x: 0, y: 0 }, b: { x: 0.1, y: 0 }, levelId: "L1" }]) - 0.1) < 1e-9);
  });
});