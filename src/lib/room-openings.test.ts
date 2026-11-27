import { test } from "node:test";
import assert from "node:assert/strict";
import { ceilingBottom, fillRoomCeiling, normalizeCeilingHeight, parseCeilingHeight } from "./room-ceiling";
import { buildLevelDetail3d, detail3dInputForSketch, type Detail3dInput } from "./level-detail-3d";
import { detail3dCeilings } from "./detail3d-ceiling";
import { section3dCeilings, section3dFrame, clipPrismsToSection, sectionCutFaces } from "./section-3d";
import { edgeMaterialKey } from "./edge-segments";
import { normalizeDoor, type DoorStyle } from "./doors";
import { normalizeWindow, windowVerticalRange } from "./windows";

const square = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }];
const line = { a: square[0], b: square[1], levelId: "a" };
const base = (ceilingHeightM?: number | null): Detail3dInput => ({
  pxPerMeter: 100, levelId: "a", wallHeight: 4, lines: [line],
  edgeAttrs: { [edgeMaterialKey("a", line.a, line.b)]: "solid" },
  rooms: [{ id: "room", name: "Kantor", points: square, color: "room", ...(ceilingHeightM !== undefined ? { ceilingHeightM } : {}) }],
  windows: [], doors: [], upperFootprint: [[square]],
});
const door = { id: "d", a: { x: 100, y: 0 }, b: { x: 200, y: 0 }, nx: 0, ny: 1, widthCm: 100, leaves: 1 as const };
const window = { ...door, id: "w", heightType: "floor-to-ceiling" as const };

test("tinggi plafon bawaan 2,8 m dan null bukan angka nol", () => {
  assert.equal(normalizeCeilingHeight(undefined), 2.8);
  assert.equal(normalizeCeilingHeight(NaN), 2.8);
  assert.equal(normalizeCeilingHeight(null), null);
  assert.equal(ceilingBottom(undefined, 4), 2.8);
});
test("tinggi manual menerima desimal koma dan menolak angka tidak valid", () => {
  assert.equal(parseCeilingHeight("3,15"), 3.15);
  assert.equal(parseCeilingHeight("0"), undefined);
  assert.equal(parseCeilingHeight("tanpa plafon"), undefined);
});
test("fill handle plafon atomik hanya pada baris terlihat dalam level sama", () => {
  const rooms = [{ id: "r1", levelId: "a", ceilingHeightM: 2.8, material: "m1" }, { id: "r2", levelId: "a", ceilingHeightM: 3, material: "m2" }, { id: "hidden", levelId: "a", ceilingHeightM: 3.5, material: "m3" }, { id: "r3", levelId: "b", ceilingHeightM: 3.2, material: "m4" }];
  const result = fillRoomCeiling(rooms, "a", ["r1", "r2", "r3"], 0, 2, null);
  assert.deepEqual(result.map(room => room.ceilingHeightM), [null, null, 3.5, 3.2]);
  assert.deepEqual(result.map(room => room.material), ["m1", "m2", "m3", "m4"]);
  assert.equal(rooms[0].ceilingHeightM, 2.8);
  assert.deepEqual(fillRoomCeiling(rooms, "a", ["r1", "r2"], 1, 0, 3.1).map(room => room.ceilingHeightM), [3.1, 3.1, 3.5, 3.2]);
});
test("tanpa plafon menghilangkan papan dan rangka pada Detail 3D dan Potongan 3D", () => {
  const input = base(null);
  assert.equal(detail3dCeilings(input).length, 0);
  assert.equal(section3dCeilings(input.rooms, [{ outer: square, thicknessMm: 150 }], 100, 4).length, 0);
  assert.ok(detail3dCeilings(base()).some(p => p.kind === "ceiling" && p.bottom === 2.8));
});
test("plafon ruang berbeda tidak saling mengubah ketinggian", () => {
  const input = base(3.1);
  const other = square.map(p => ({ x: p.x + 600, y: p.y }));
  const parts = section3dCeilings([...input.rooms, { name: "Ruang lain", points: other, ceilingHeightM: 2.6 }], [{ outer: square, thicknessMm: 150 }, { outer: other, thicknessMm: 150 }], 100, 4);
  assert.deepEqual(parts.filter(p => p.kind === "ceiling").map(p => p.bottom).sort(), [2.6, 3.1]);
});
test("jendela Floor to Ceiling tersimpan dan rentangnya lantai hingga plafon", () => {
  assert.equal(normalizeWindow(window)?.heightType, "floor-to-ceiling");
  assert.deepEqual(windowVerticalRange("floor-to-ceiling", 4, 2.4, 3.1), { sill: 0, head: 3.1 });
});
for (const height of [2.8, 3.1]) test(`jendela Floor to Ceiling bertemu bawah plafon ${height} m di Detail dan Potongan 3D`, () => {
  const input = { ...base(height), windows: [window] };
  const model = buildLevelDetail3d(input);
  const board = detail3dCeilings(input).find(p => p.kind === "ceiling");
  assert.ok(board);
  assert.equal(model.windows[0]?.sill, 0);
  assert.equal(model.windows[0]?.head, board.bottom);
  assert.ok(model.prisms.some(p => p.kind === "wall" && p.bottom === height));
  const frame = section3dFrame({ x: 150, y: -100 }, { x: 150, y: 500 }, 100);
  assert.ok(frame);
  const faces = sectionCutFaces(clipPrismsToSection(model.prisms, frame), frame);
  assert.ok(faces.some(p => p.kind === "glass" && p.bottom === 0 && p.top === height));
});
test("bukaan mengikuti plafon yang diturunkan agar rangka muat di bawah pelat", () => {
  const input = { ...base(3.5), wallHeight: 3, windows: [window] };
  const board = detail3dCeilings(input).find(p => p.kind === "ceiling");
  assert.ok(board);
  assert.equal(buildLevelDetail3d(input).windows[0]?.head, board.bottom);
});
for (const style of ["standard", "glass", "window-wall", "floor-to-ceiling"] as const) {
  for (const type of ["swing", "sliding", "folding"] as const) test(`pintu ${style} mempertahankan gerak ${type} dan material/ambang`, () => {
    const input = { ...base(3.1), doors: [{ ...door, style, type }] };
    const model = buildLevelDetail3d(input);
    assert.equal(normalizeDoor({ ...door, style, type })?.style, style);
    assert.equal(normalizeDoor({ ...door, style, type })?.type, type);
    assert.equal(model.doors[0]?.head, 2.4);
    assert.equal(model.prisms.some(p => p.kind === "door"), style === "standard");
    const above = model.prisms.filter(p => p.kind === "wall" && p.bottom > 0);
    if (style === "window-wall") {
      assert.equal(above.length, 0);
      assert.ok(model.prisms.some(p => p.kind === "glass" && p.bottom === 2.4 && p.top === 4));
    } else if (style === "floor-to-ceiling") {
      assert.equal(above[0]?.bottom, 3.1);
      assert.ok(model.prisms.some(p => p.kind === "glass" && p.bottom === 2.4 && p.top === 3.1));
    } else assert.equal(above[0]?.bottom, 2.4);
  });
}
test("proyeksi sketsa mempertahankan tinggi plafon/null dan identitas/tipe pintu", () => {
  const sketch = { levels: [{ id: "a", mdpl: 0 }, { id: "b", mdpl: 4 }], layers: [{ id: "room", levelId: "a", name: "Kantor", points: square, ceilingHeightM: null }], doors: [{ ...door, levelId: "a", style: "glass" as DoorStyle }] };
  const input = detail3dInputForSketch(sketch, "a", 100);
  assert.equal(input.rooms[0]?.ceilingHeightM, null);
  assert.equal(input.doors[0]?.id, "d");
  assert.equal(input.doors[0]?.style, "glass");
});
test("pelat atas 250 mm membatasi plafon dan jendela pada bidang sama", () => {
  const input = { ...base(3.5), wallHeight: 3, upperSlabThicknessMm: 250, windows: [window] };
  const board = detail3dCeilings(input).find(p => p.kind === "ceiling");
  assert.ok(board);
  assert.equal(board.bottom, 3 - 0.25 - 0.065);
  assert.equal(buildLevelDetail3d(input).windows[0]?.head, board.bottom);
});