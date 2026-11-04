import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dimensionBasis, exteriorGridChains, exteriorRoomChains } from "./detail-exterior-dimensions";
const rect = (id: string, x: number, y: number, w: number, h: number) => ({ id, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const rotate = (room: ReturnType<typeof rect>, angle: number) => ({ ...room, points: room.points.map((p) => { const { u, n } = dimensionBasis(angle); return { x: p.x * u.x + p.y * n.x, y: p.x * u.y + p.y * n.y }; }) });
describe("exterior detail dimensions", () => {
  it("takes only the outer rooms, excluding an internal partition", () => {
    const chains = exteriorRoomChains([rect("a", 0, 0, 800, 400), rect("b", 800, 0, 800, 400), rect("inner", 400, 400, 200, 200)], 1);
    assert.deepEqual(chains.find((c) => c.side === "top")?.coordinates, [0, 800, 1600]);
    assert.deepEqual(chains.find((c) => c.side === "top")?.roomIds, ["a", "b"]);
  });
  it("follows a 20 degree exterior direction shared by more than one room", () => {
    const rooms = [rotate(rect("a", 0, 0, 800, 400), 20), rotate(rect("b", 800, 0, 800, 400), 20), rect("single", 3000, 0, 200, 200)];
    const top = exteriorRoomChains(rooms, 1).find((c) => c.side === "top");
    assert.ok(top);
    assert.ok(Math.abs(top.angle - 20) < 1e-8);
    assert.deepEqual(top.roomIds, ["a", "b"]);
    assert.ok(Math.abs(top.coordinates[1] - 800) < 1e-8);
  });
  it("uses only four outer grid sides, perpendicular to the measured grid lines", () => {
    const chains = exteriorGridChains([{ gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 20, xs: [0, 800, 1600], ys: [0, 800, 1600] }], [], 1);
    assert.equal(chains.length, 4);
    const top = chains.find((c) => c.side === "top");
    assert.ok(top);
    const { u } = dimensionBasis(top.angle), measuredGrid = dimensionBasis(110).u;
    assert.ok(Math.abs(u.x * measuredGrid.x + u.y * measuredGrid.y) < 1e-8);
    assert.ok(Math.abs(top.coordinates[2] - top.coordinates[1] - 800) < 1e-8);
    assert.ok(Math.abs(top.face) < 1e-8);
  });
  it("removes the inner grid when multiple grids compete for the same exterior side", () => {
    const grids = [{ gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 0, xs: [0, 800, 1600], ys: [0, 800, 1600] }, { gridIndex: 1, origin: { x: 400, y: 400 }, rotation: 0, xs: [400, 800, 1200], ys: [400, 800, 1200] }];
    assert.deepEqual(exteriorGridChains(grids, [], 1).map((c) => c.gridIndex), [0, 0, 0, 0]);
  });
  it("uses the oblique exterior grid rather than the crossed-out orthogonal right side", () => {
    const rooms = [rotate(rect("a", 0, 0, 800, 800), 20), rotate(rect("b", 0, 800, 800, 800), 20)];
    const grids = [{ gridIndex: 0, origin: { x: 0, y: 0 }, rotation: 0, xs: [0, 800, 1600], ys: [0, 800, 1600] }, { gridIndex: 1, origin: { x: 0, y: 0 }, rotation: 20, xs: [0, 800], ys: [0, 800, 1600] }];
    const right = exteriorGridChains(grids, exteriorRoomChains(rooms, 1), 1).find((c) => c.side === "right");
    assert.equal(right?.gridIndex, 1);
    assert.ok(Math.abs((right?.angle ?? 0) + 70) < 1e-8);
  });
});