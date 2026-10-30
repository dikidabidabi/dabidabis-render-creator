import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { curvePrintSlices, PRINTABLE_WIDTH_PX, printZoom } from "./schedule-print";

describe("printZoom", () => {
  test("mengecilkan konten lebar agar muat kiri-kanan kertas A4 lanskap", () => {
    assert.ok(Math.abs(printZoom(1600) - PRINTABLE_WIDTH_PX / 1600) < 1e-6);
    assert.ok(Math.abs(printZoom(2092) - PRINTABLE_WIDTH_PX / 2092) < 1e-9);
  });

  test("tidak pernah membesar melebihi 100% dan menolak lebar tidak valid", () => {
    assert.equal(printZoom(800), 1);
    assert.equal(printZoom(PRINTABLE_WIDTH_PX), 1);
    assert.equal(printZoom(0), 1);
    assert.equal(printZoom(Number.NaN), 1);
  });
});

describe("curvePrintSlices", () => {
  test("42 task labels and chart rows share complete page slices without a blank first page", () => {
    const slices = curvePrintSlices(42, 34, 1428, 66, 600, 720);
    assert.deepEqual(slices.map(({ from, to }) => [from, to]), [[0, 17], [17, 38], [38, 42]]);
    assert.deepEqual(slices.map(({ offset }) => offset), [0, 578, 1292]);
    assert.equal(slices.reduce((sum, slice) => sum + slice.height, 0), 1494);
    assert.equal(slices[2]?.axes, true);
    assert.ok(slices.every((slice, index) => slice.height <= (index ? 720 : 600)));
  });
  test("a compact curve stays immediately below its heading on the first page", () => {
    assert.deepEqual(curvePrintSlices(0, 0, 320, 66, 600, 720), [{ from: 0, to: 0, offset: 0, height: 386, axes: true }]);
  });
  test("four weekly summary rows stay with the final curve slice and axes", () => {
    const footer = 4 * 28 + 3 * 22;
    const slices = curvePrintSlices(42, 34, 1428, footer, 600, 720);
    assert.equal(slices.reduce((sum, slice) => sum + slice.height, 0), 1428 + footer);
    assert.equal(slices.filter((slice) => slice.axes).length, 1);
    assert.equal(slices.at(-1)?.axes, true);
    assert.ok(slices.every((slice, index) => slice.height <= (index ? 720 : 600)));
  });
});
