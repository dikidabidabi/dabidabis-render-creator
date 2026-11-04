import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exteriorRoomChains, exteriorGridChains, gridChainAxisLabels } from "./detail-exterior-dimensions";

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

  it("only projects the outermost rooms on each side, never inner rooms", () => {
    const rooms = [
      { id: "front", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }] },
      { id: "back", points: [{ x: 2, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 8 }, { x: 2, y: 8 }] },
    ];
    const chains = exteriorRoomChains(rooms, 0.01);
    const bottom = chains.find((c) => c.side === "bottom");
    const top = chains.find((c) => c.side === "top");
    assert.ok(bottom && top);
    // Sisi bawah hanya diukur dari ruang "back" (terluar), bukan dari ruang "front".
    assert.deepEqual(bottom.roomIds, ["back"]);
    assert.deepEqual(bottom.coordinates, [2, 8]);
    assert.deepEqual(top.roomIds, ["front"]);
    assert.deepEqual(top.coordinates, [0, 10]);
  });

  it("measures every outermost room segment along an L-shaped side", () => {
    const rooms = [
      { id: "deep", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 8 }, { x: 0, y: 8 }] },
      { id: "shallow", points: [{ x: 5, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 6 }, { x: 5, y: 6 }] },
    ];
    const chains = exteriorRoomChains(rooms, 0.01);
    const bottom = chains.find((c) => c.side === "bottom");
    assert.ok(bottom);
    // Kedua ruang adalah ruang terluar pada segmennya masing-masing di sisi bawah.
    assert.deepEqual(bottom.roomIds, ["deep", "shallow"]);
    assert.deepEqual(bottom.coordinates, [0, 5, 12]);
  });

  it("uses the millimeter grid angle when no structural grid exists", () => {
    const rooms = [{ id: "a", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }] }];
    const chains = exteriorRoomChains(rooms, 0.01, [], 15);
    assert.equal(chains.length, 4);
    assert.deepEqual(chains.map((c) => Math.round(c.angle)).sort((a, b) => a - b), [-75, -75, 15, 15]);
  });
});

describe("grid bubble labels follow the grid axes", () => {
  it("numbers horizontal chains and letters vertical chains", () => {
    const grid = { gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 0, xs: [0, 6, 12], ys: [0, 4, 8] };
    const chains = exteriorGridChains([grid], [], 0.01);
    const top = chains.find((c) => c.side === "top");
    const left = chains.find((c) => c.side === "left");
    assert.ok(top && left);
    // Rantai atas: sumbu x kiri ke kanan memakai angka.
    assert.deepEqual(gridChainAxisLabels(top, [grid], 0.01), ["1", "2", "3"]);
    // Rantai kiri: huruf mengikuti posisi sumbu y, bukan urutan koordinat.
    const leftLabels = gridChainAxisLabels(left, [grid], 0.01);
    assert.deepEqual([...leftLabels].sort(), ["A", "B", "C"]);
    const topmostIndex = left.coordinates.reduce((best, value, index) => (value > left.coordinates[best] ? index : best), 0);
    assert.equal(leftLabels[topmostIndex], "A");
  });

  it("respects label offsets and grid rotation", () => {
    const grid = { gridIndex: 0, origin: { x: 10, y: 10 }, rotation: 30, xs: [10, 16], ys: [10, 15], labelOffsetX: 2, labelOffsetY: 1 };
    const chains = exteriorGridChains([grid], [], 0.01);
    assert.equal(chains.length, 4);
    for (const chain of chains) {
      const labels = gridChainAxisLabels(chain, [grid], 0.01);
      assert.deepEqual([...labels].sort(), chain.side === "top" || chain.side === "bottom" ? ["3", "4"] : ["B", "C"]);
    }
  });

  it("keeps labels aligned when the chain direction is normalized backwards", () => {
    const grid = { gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 120, xs: [0, 6, 12], ys: [0, 4] };
    const chains = exteriorGridChains([grid], [], 0.01);
    assert.equal(chains.length, 4);
    const numeric = chains.filter((chain) => gridChainAxisLabels(chain, [grid], 0.01).includes("1"));
    const lettered = chains.filter((chain) => gridChainAxisLabels(chain, [grid], 0.01).includes("A"));
    assert.equal(numeric.length, 2);
    assert.equal(lettered.length, 2);
    for (const chain of numeric) {
      assert.deepEqual([...gridChainAxisLabels(chain, [grid], 0.01)].sort(), ["1", "2", "3"]);
    }
    for (const chain of lettered) {
      assert.deepEqual([...gridChainAxisLabels(chain, [grid], 0.01)].sort(), ["A", "B"]);
    }
  });
});
