import { test } from "node:test";
import { strict as assert } from "node:assert";
import { slidePdfRaster, slidePdfFileName, SLIDE_PDF_MAX_PIXELS } from "./slide-pdf";

test("A1 is 841×594 mm landscape", () => {
  const r = slidePdfRaster("A1", 1414, 1000);
  assert.equal(r.widthMm, 841);
  assert.equal(r.heightMm, 594);
});
test("A2 is 594×420 mm landscape at 200 dpi", () => {
  const r = slidePdfRaster("A2", 1414, 1000);
  assert.equal(r.widthMm, 594);
  assert.equal(r.heightMm, 420);
  assert.equal(r.effectiveDpi, 200);
});
test("A1 stays high resolution within the safe canvas size", () => {
  const r = slidePdfRaster("A1", 1414, 1000);
  assert.ok(r.width * r.height <= SLIDE_PDF_MAX_PIXELS);
  assert.ok(r.effectiveDpi >= 140);
});
test("file name carries slide number and paper", () => {
  assert.equal(slidePdfFileName("Rumah Sakit", 3, "Denah Lantai 1", "A2"), "Rumah_Sakit_slide-3_Denah_Lantai_1_A2.pdf");
});
