import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exteriorRoomChains, exteriorGridChains } from "./detail-exterior-dimensions";

const rot = (p: { x: number; y: number }, deg: number) => {
  const r = deg * Math.PI / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

describe("exterior dimensions per orientation cluster", () => {
  it("keeps a separate bottom chain for an oblique room cluster", () => {
    const rooms = [
      { id: "a", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }] },
      { id: "b", points: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }, { x: 10, y: 5 }] },
      { id: "c", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }].map((p) => rot({ x: p.x + 20, y: p.y + 20 }, 20)) },
    ];
    const bottoms = exteriorRoomChains(rooms, 0.01).filter((c) => c.side === "bottom");
    assert.equal(bottoms.length, 2);
    assert.ok(bottoms.some((c) => Math.abs(c.angle - 20) < 1));
  });

  it("keeps grid boundaries on all four sides for every grid orientation", () => {
    const grids = [
      { gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 0, xs: [0, 8], ys: [0, 8] },
      { gridIndex: 1, origin: { x: 30, y: 30 }, rotation: 20, xs: [30, 38], ys: [30, 38] },
    ];
    assert.equal(exteriorGridChains(grids, [], 0.01).length, 8);
  });
});
