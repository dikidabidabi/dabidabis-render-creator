import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { PRINTABLE_WIDTH_PX, printZoom } from "./schedule-print";

describe("printZoom", () => {
  test("mengecilkan konten lebar agar muat kiri-kanan kertas A4 lanskap", () => {
    assert.ok(Math.abs(printZoom(1600) - PRINTABLE_WIDTH_PX / 1600) < 1e-6);
    assert.ok(Math.abs(printZoom(2092) - 0.5) < 1e-6);
  });

  test("tidak pernah membesar melebihi 100% dan menolak lebar tidak valid", () => {
    assert.equal(printZoom(800), 1);
    assert.equal(printZoom(PRINTABLE_WIDTH_PX), 1);
    assert.equal(printZoom(0), 1);
    assert.equal(printZoom(Number.NaN), 1);
  });
});
