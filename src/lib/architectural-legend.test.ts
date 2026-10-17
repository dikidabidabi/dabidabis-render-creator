import { test } from "node:test";
import { strict as assert } from "node:assert";
import { architecturalLegendEnabled, architecturalLegendRooms } from "./architectural-legend";
test("legend defaults off", () => {
  assert.equal(architecturalLegendEnabled({ showArchitectural: true }), false);
  assert.equal(architecturalLegendEnabled({ showArchitectural: true, showArchitecturalLegend: false }), false);
});
test("legend requires architectural mode", () => {
  assert.equal(architecturalLegendEnabled({ showArchitectural: true, showArchitecturalLegend: true }), true);
  assert.equal(architecturalLegendEnabled({ showArchitectural: false, showArchitecturalLegend: true }), false);
});
test("room numbers share a sequence with names and areas intact", () => {
  const rooms = [{ id: "a", name: "Ruang Tunggu", areaM2: 24 }, { id: "b", name: "Ruang Periksa", areaM2: 16 }];
  assert.deepEqual(architecturalLegendRooms(rooms).map(({ room, number }) => [number, room.id, room.name, room.areaM2]), [[1, "a", "Ruang Tunggu", 24], [2, "b", "Ruang Periksa", 16]]);
  assert.equal(architecturalLegendRooms(rooms)[0].room, rooms[0]);
});
