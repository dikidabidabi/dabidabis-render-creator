import { describe, expect, it } from "vitest";
import { PRINTABLE_WIDTH_PX, printZoom } from "./schedule-print";

describe("printZoom", () => {
  it("mengecilkan konten lebar agar muat kiri-kanan kertas A4 lanskap", () => {
    expect(printZoom(1600)).toBeCloseTo(PRINTABLE_WIDTH_PX / 1600);
    expect(printZoom(2092)).toBeCloseTo(0.5);
  });

  it("tidak pernah membesar melebihi 100% dan menolak lebar tidak valid", () => {
    expect(printZoom(800)).toBe(1);
    expect(printZoom(PRINTABLE_WIDTH_PX)).toBe(1);
    expect(printZoom(0)).toBe(1);
    expect(printZoom(Number.NaN)).toBe(1);
  });
});
