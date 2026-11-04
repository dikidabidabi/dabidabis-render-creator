import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exteriorRoomChains, exteriorGridChains } from "./detail-exterior-dimensions";

const rot = (p: { x: number; y: number }, deg: number) => {
  const r = deg * Math.PI / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

describe("detail dimensions follow grid orientation on all sides", () => {
  it("projects differently oriented rooms onto the grid's four sides", () => {
    const rooms = [
      { id: "a", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }] },
      { id: "b", points: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }, { x: 10, y: 5 }] },
      { id: "c", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }].map((p) => rot({ x: p.x + 20, y: p.y + 20 }, 20)) },
    ];
    const grid = { gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 0, xs: [0, 40], ys: [0, 40] };
    const chains = exteriorRoomChains(rooms, 0.01, [grid]);
    assert.equal(chains.length, 4);
    assert.deepEqual(new Set(chains.map((c) => c.side)), new Set(["top", "bottom", "left", "right"]));
    assert.deepEqual(chains.map((c) => c.angle).sort((a, b) => a - b), [-90, -90, 0, 0]);
  });

  it("keeps grid boundaries on all four sides for every grid orientation", () => {
    const grids = [
      { gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 0, xs: [0, 8], ys: [0, 8] },
      { gridIndex: 1, origin: { x: 30, y: 30 }, rotation: 20, xs: [30, 38], ys: [30, 38] },
    ];
    assert.equal(exteriorGridChains(grids, [], 0.01).length, 8);
  });

  it("keeps all four boundaries for grids with the same orientation", () => {
    const grids = [
      { gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 0, xs: [0, 8], ys: [0, 8] },
      { gridIndex: 1, origin: { x: 30, y: 30 }, rotation: 0, xs: [30, 38], ys: [30, 38] },
    ];
    assert.equal(exteriorGridChains(grids, [], 0.01).length, 8);
  });

  it("uses a 30 degree grid rather than a 20 degree room", () => {
    const rooms = [{ id: "a", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }].map((p) => rot(p, 20)) }];
    const grid = { gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 30, xs: [0, 10], ys: [0, 10] };
    const chains = exteriorRoomChains(rooms, 0.01, [grid]);
    assert.equal(chains.length, 4);
    assert.deepEqual(chains.map((c) => Math.round(c.angle)).sort((a, b) => a - b), [-60, -60, 30, 30]);
    for (const chain of chains) assert.ok(chain.coordinates.length >= 2);
  });

  it("uses the millimeter grid angle when no structural grid exists", () => {
    const rooms = [{ id: "a", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }] }];
    const chains = exteriorRoomChains(rooms, 0.01, [], 15);
    assert.equal(chains.length, 4);
    assert.deepEqual(chains.map((c) => Math.round(c.angle)).sort((a, b) => a - b), [-75, -75, 15, 15]);
  });
});
