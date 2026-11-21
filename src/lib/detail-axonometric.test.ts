import { test } from "node:test";
import assert from "node:assert/strict";
import { detailAxoGap, detailAxoLinks, detailAxoStack, type AxoStackLevel } from "./detail-axonometric";
import type { Detail3dInput } from "./level-detail-3d";
import type { Stair } from "./stairs";

const PPM = 100;
const square = (x: number, y: number, s = 200) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const level = (id: string, mdpl: number, rooms: Detail3dInput["rooms"], wallHeight = 4): AxoStackLevel => ({
  levelId: id, mdpl,
  input: { pxPerMeter: PPM, levelId: id, lines: [], rooms, doors: [], windows: [], wallHeight },
});

test("lantai disusun dari terendah dengan jarak renggang di atas dinding", () => {
  const stack = detailAxoStack([level("b", 4, []), level("a", 0, [], 3.5)], 5);
  assert.deepEqual(stack, [{ levelId: "a", base: 0 }, { levelId: "b", base: 8.5 }]);
});

test("jarak renggang minimal 3 m dan maksimal 30 m", () => {
  assert.equal(detailAxoGap(2), 3);
  assert.equal(detailAxoGap(20), 8);
  assert.equal(detailAxoGap(500), 30);
});

test("lift dan tangga dihubungkan ke lantai berikutnya, ruang lain tidak", () => {
  const links = detailAxoLinks([
    level("a", 0, [{ name: "Lift", points: square(0, 0), color: "#000" }, { name: "Tangga", points: square(1000, 0), color: "#000" }, { name: "Lobby", points: square(500, 500), color: "#000" }]),
    level("b", 4, [{ name: "Lift", points: square(0, 0), color: "#000" }, { name: "Tangga Darurat", points: square(1050, 0), color: "#000" }, { name: "Lobby", points: square(500, 500), color: "#000" }]),
  ]);
  assert.deepEqual(links.map((l) => `${l.kind}:${l.from.levelId}>${l.to.levelId}`).sort(), ["lift:a>b", "tangga:a>b"]);
});

test("lift berjauhan lebih dari 3 m tidak dihubungkan", () => {
  const links = detailAxoLinks([
    level("a", 0, [{ name: "Lift", points: square(0, 0), color: "#000" }]),
    level("b", 4, [{ name: "Lift", points: square(1000, 0), color: "#000" }]),
  ]);
  assert.equal(links.length, 0);
});

test("objek tangga sketsa menghubungkan level asal ke level tujuan", () => {
  const stair = { id: "s", levelId: "a", toLevelId: "b", kind: "lurus", a: { x: 0, y: 0 }, b: { x: 400, y: 0 }, widthM: 1.2, stepCount: 18, landing: false, offsetM: 0.2, innerRadiusM: 0.45, rotationDeg: 0, createdAt: 0 } as Stair;
  const links = detailAxoLinks([level("a", 0, []), level("b", 4, []), level("c", 8, [])], [stair, { ...stair, id: "x", toLevelId: "zz" }]);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.kind, "tangga");
  assert.equal(links[0]!.from.levelId, "a");
  assert.equal(links[0]!.to.levelId, "b");
});
