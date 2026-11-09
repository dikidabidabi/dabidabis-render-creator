import { test } from "node:test";
import { strict as assert } from "node:assert";
import { curveEndDirections, curveWallBand, sampleCurveLine } from "./curve-wall";

const close = (actual: number, expected: number, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);

test("sampel garis lengkung dimulai dan berakhir di kedua ujung garis", () => {
  const points = sampleCurveLine({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, kind: "arc", bulge: 20 });
  assert.deepEqual(points[0], { x: 0, y: 0 });
  assert.deepEqual(points[points.length - 1], { x: 100, y: 0 });
  // Titik tengah busur kuadrat berada pada setengah jarak kontrol (2 × bulge) → 20.
  const middle = points[Math.floor(points.length / 2)];
  close(middle.x, 50);
  close(middle.y, 20);
});

test("garis tangent (bezier) mengikuti titik kontrolnya", () => {
  const points = sampleCurveLine({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, kind: "bezier", c1: { x: 0, y: 40 }, c2: { x: 100, y: 40 } });
  close(points[Math.floor(points.length / 2)].y, 30);
});

test("pita dinding lengkung setebal 150 mm di setiap titik", () => {
  const points = sampleCurveLine({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, kind: "arc", bulge: 30 });
  const band = curveWallBand(points, 7.5, 0);
  assert.equal(band.length, points.length * 2);
  for (let i = 0; i < points.length; i++) {
    const left = band[i], right = band[band.length - 1 - i];
    assert.ok(Math.hypot(left.x - points[i].x, left.y - points[i].y) >= 7.5 - 1e-6);
    assert.ok(Math.hypot(left.x - right.x, left.y - right.y) / 2 < 7.6);
  }
});

test("arah ujung dipakai untuk kolom praktis", () => {
  const directions = curveEndDirections([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]);
  assert.deepEqual(directions?.start, { x: 1, y: 0 });
  close(directions!.end.x, -Math.SQRT1_2);
});
