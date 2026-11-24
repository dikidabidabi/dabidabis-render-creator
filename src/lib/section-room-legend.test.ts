import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSectionLegendRooms, sectionLegendMetrics } from "./section-room-legend";

test("menomori dari level terendah dan menggabung nama sama dengan selisih luas ≤ 2 m²", () => {
    const { rooms, numberByLayerId } = groupSectionLegendRooms([
      { name: "Lantai 1", slices: [
        { layerId: "a", name: "Kamar", color: "c", areaM2: 12 },
        { layerId: "b", name: "Dapur", color: "c", areaM2: 9 },
      ] },
      { name: "Lantai 2", slices: [
        { layerId: "c", name: "kamar ", color: "c", areaM2: 13.5 },
        { layerId: "d", name: "Kamar", color: "c", areaM2: 20 },
      ] },
    ]);
    assert.deepEqual(rooms.map((r) => [r.number, r.name]), [[1, "Kamar"], [2, "Dapur"], [3, "Kamar"]]);
    assert.equal(numberByLayerId.get("c"), 1);
    assert.equal(numberByLayerId.get("d"), 3);
    assert.equal(rooms[0]?.areaM2, 12.75);
  });

test("memakai ukuran teks yang sama dengan Potongan Prinsip", () => {
    assert.deepEqual(sectionLegendMetrics(10), { cols: 1, width: 240, fontSize: 12, marginBottom: 4 });
    assert.deepEqual(sectionLegendMetrics(30), { cols: 2, width: 320, fontSize: 11, marginBottom: 4 });
  });
