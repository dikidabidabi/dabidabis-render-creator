import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVerticalLinks, verticalCirculationKind } from "./vertical-circulation";

test("lift, tangga, dan ramp dikenali dari nama ruang", () => {
  assert.equal(verticalCirculationKind("Lift Barang"), "lift");
  assert.equal(verticalCirculationKind("Tangga EVK"), "tangga");
  assert.equal(verticalCirculationKind("Ramp Parkir"), "ramp");
  assert.equal(verticalCirculationKind("Lobby"), null);
});

test("koordinat sama dan jarak di bawah 3 m terhubung, 3 m atau lebih tidak", () => {
  const order = ["L1", "L2", "L3", "L4"];
  const links = buildVerticalLinks([
    { id: "a", levelId: "L1", name: "Lift", x: 10, y: 10 },
    { id: "b", levelId: "L2", name: "Lift", x: 10, y: 10 },
    { id: "c", levelId: "L3", name: "Lift", x: 12.9, y: 10 },
    { id: "d", levelId: "L4", name: "Lift", x: 15.9, y: 10 },
  ], order);
  assert.deepEqual(links.map((l) => `${l.source}-${l.target}`), ["a-b", "b-c"]);
});

test("hanya jenis sama yang dihubungkan dan melompati lantai tanpa elemen", () => {
  const links = buildVerticalLinks([
    { id: "t1", levelId: "L1", name: "Tangga", x: 0, y: 0 },
    { id: "l2", levelId: "L2", name: "Lift", x: 0, y: 0 },
    { id: "t3", levelId: "L3", name: "Tangga Darurat", x: 1, y: 1 },
  ], ["L1", "L2", "L3"]);
  assert.deepEqual(links.map((l) => `${l.source}-${l.target}`), ["t1-t3"]);
});
