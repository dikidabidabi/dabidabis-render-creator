import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRoomsByFunctionZone, UNASSIGNED_ZONE_ID } from "./function-zones";

const zones = [
  { id: "publik", name: "Publik", color: "#ff0000" },
  { id: "privat", name: "Privat", color: "#00ff00" },
  { id: "servis", name: "Servis", color: "#0000ff" },
];

test("ruang dikelompokkan per zona fungsi, bukan per nama ruang", () => {
  const groups = groupRoomsByFunctionZone([
    { areaM2: 20, functionZoneId: "publik" },
    { areaM2: 10, functionZoneId: "publik" },
    { areaM2: 15, functionZoneId: "privat" },
  ], zones);
  assert.deepEqual(groups.map((g) => [g.name, g.count, g.areaM2]), [["Publik", 2, 30], ["Privat", 1, 15]]);
});

test("pengali tipikal ikut dihitung pada jumlah dan luas zona", () => {
  const [group] = groupRoomsByFunctionZone([{ areaM2: 12, functionZoneId: "privat", multiplier: 4 }], zones);
  assert.equal(group.count, 4);
  assert.equal(group.areaM2, 48);
});

test("ruang tanpa zona atau zona terhapus masuk Belum dikelompokkan di akhir", () => {
  const groups = groupRoomsByFunctionZone([
    { areaM2: 5 },
    { areaM2: 7, functionZoneId: "zona-hilang" },
    { areaM2: 9, functionZoneId: "servis" },
  ], zones);
  assert.deepEqual(groups.map((g) => g.id), ["servis", UNASSIGNED_ZONE_ID]);
  assert.equal(groups[1].areaM2, 12);
  assert.equal(groups[1].assigned, false);
});
