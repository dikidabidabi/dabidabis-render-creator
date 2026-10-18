import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  ARCHITECTURAL_LEGEND_COLUMNS,
  ARCHITECTURAL_LEGEND_FONTS,
  ARCHITECTURAL_LEGEND_WIDTH_RATIO,
  architecturalLegendEnabled,
  architecturalLegendLayout,
  architecturalLegendRooms,
  wrapArchitecturalLegendName,
} from "./architectural-legend";

const SLIDE = { width: 1414, height: 1000 };
const BOX = { width: SLIDE.width * ARCHITECTURAL_LEGEND_WIDTH_RATIO, height: 670 };

const rooms = (count: number, name = "Ruang Tunggu") =>
  Array.from({ length: count }, (_, index) => ({ id: `r${index}`, name, areaM2: 12.5 }));

test("legend defaults off", () => {
  assert.equal(architecturalLegendEnabled({ showArchitectural: true }), false);
  assert.equal(architecturalLegendEnabled({ showArchitectural: true, showArchitecturalLegend: false }), false);
});

test("legend requires architectural mode", () => {
  assert.equal(architecturalLegendEnabled({ showArchitectural: true, showArchitecturalLegend: true }), true);
  assert.equal(architecturalLegendEnabled({ showArchitectural: false, showArchitecturalLegend: true }), false);
});

test("room numbers share a sequence with names and areas intact", () => {
  const two = [{ id: "a", name: "Ruang Tunggu", areaM2: 24 }, { id: "b", name: "Ruang Periksa", areaM2: 16 }];
  assert.deepEqual(architecturalLegendRooms(two).map(({ room, number }) => [number, room.id, room.name, room.areaM2]), [[1, "a", "Ruang Tunggu", 24], [2, "b", "Ruang Periksa", 16]]);
  assert.equal(architecturalLegendRooms(two)[0].room, two[0]);
});

test("legend text is double the single-column sizes", () => {
  assert.deepEqual(ARCHITECTURAL_LEGEND_FONTS, { level: 40, elevation: 32, number: 36, name: 34, area: 30 });
});

test("legend splits rooms into two columns", () => {
  const layout = architecturalLegendLayout(rooms(8), BOX, "Lantai 1");
  assert.equal(layout.columns.length, ARCHITECTURAL_LEGEND_COLUMNS);
  assert.deepEqual(layout.columns.map((column) => column.length), [4, 4]);
  assert.equal(layout.scale, 1);
  assert.ok(layout.needed <= BOX.height);
});

test("room numbers keep ascending order across both columns", () => {
  const layout = architecturalLegendLayout(rooms(6), BOX, "Lantai 2");
  const numbers = layout.columns.flat().map((row) => row.number);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(layout.columns.map((column) => column.map((row) => row.number)), [[1, 2, 3], [4, 5, 6]]);
});

test("long room names wrap inside their column", () => {
  const layout = architecturalLegendLayout(rooms(2, "Ruang Perawatan Pasien Intensif"), BOX, "Lantai 1");
  const row = layout.columns.flat()[0];
  assert.ok(row.nameLines.length > 1);
  for (const line of row.nameLines) assert.ok(line.length <= layout.maxChars, line);
  assert.ok(row.nameLines[0].length * ARCHITECTURAL_LEGEND_FONTS.name * 0.55 + ARCHITECTURAL_LEGEND_NUMBER_PREFIX <= layout.colW);
  assert.equal(wrapArchitecturalLegendName("", 12).join(""), "Ruang");
});

test("many rooms shrink to fit without overflowing the box", () => {
  const layout = architecturalLegendLayout(rooms(40), BOX, "Lantai 1");
  assert.ok(layout.scale < 1);
  assert.ok(layout.needed * layout.scale <= BOX.height + 0.01);
});
