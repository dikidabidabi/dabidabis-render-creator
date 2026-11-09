import { describe, expect, it } from "vitest";
import { curveEndDirections, curveWallBand, sampleCurveLine } from "./curve-wall";

describe("dinding lengkung Pick Material", () => {
  it("sampel garis lengkung dimulai dan berakhir di kedua ujung garis", () => {
    const points = sampleCurveLine({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, kind: "arc", bulge: 20 });
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });
    // Titik tengah busur kuadrat berada pada setengah jarak kontrol (2 × bulge) → 20.
    const middle = points[Math.floor(points.length / 2)];
    expect(middle.x).toBeCloseTo(50, 5);
    expect(middle.y).toBeCloseTo(20, 5);
  });

  it("garis tangent (bezier) mengikuti titik kontrolnya", () => {
    const points = sampleCurveLine({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, kind: "bezier", c1: { x: 0, y: 40 }, c2: { x: 100, y: 40 } });
    expect(points[Math.floor(points.length / 2)].y).toBeCloseTo(30, 5);
  });

  it("pita dinding lengkung setebal 150 mm di setiap titik", () => {
    const points = sampleCurveLine({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, kind: "arc", bulge: 30 });
    const band = curveWallBand(points, 7.5, 0);
    expect(band).toHaveLength(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      const left = band[i], right = band[band.length - 1 - i];
      expect(Math.hypot(left.x - points[i].x, left.y - points[i].y)).toBeGreaterThanOrEqual(7.5 - 1e-6);
      expect(Math.hypot(left.x - right.x, left.y - right.y) / 2).toBeLessThan(7.6);
    }
  });

  it("arah ujung dipakai untuk kolom praktis", () => {
    const directions = curveEndDirections([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]);
    expect(directions?.start).toEqual({ x: 1, y: 0 });
    expect(directions?.end.x).toBeCloseTo(-Math.SQRT1_2);
  });
});
