import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeStairs, rotateStair, stairContains, stairMetrics, stairPlanGeometry, translateStair, type Stair } from "./stairs";

const stair: Stair = { id: "S", kind: "bebas", levelId: "L1", toLevelId: "L2", a: { x: 0, y: 0 }, b: { x: 400, y: 400 }, pathPoints: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }], widthM: 1.2, stepCount: 18, landing: true, offsetM: 0, innerRadiusM: 0.45, rotationDeg: 0, createdAt: 0 };
describe("free stairs", () => {
  test("L bend reserves a level landing and distributes 18 steps", () => {
    const plan = stairPlanGeometry(stair, 100);
    assert.equal(plan.landings.length, 1);
    assert.equal(plan.stepLines.length, 18);
    assert.equal(plan.sectionSurfaces.filter((s) => s.kind === "landing")[0].elevationRatio, 0.5);
    assert.equal(plan.totalRunM, 6.8);
    assert.equal(stairContains(stair, { x: 400, y: 0 }, 100), true);
    assert.equal(stairContains(stair, { x: 200, y: 200 }, 100), false);
  });
  test("arbitrary angles and multiple bends produce finite continuous geometry", () => {
    const pathPoints = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 450, y: 220 }, { x: 200, y: 450 }];
    const plan = stairPlanGeometry({ ...stair, pathPoints }, 100);
    assert.equal(plan.landings.length, 2);
    assert.equal(plan.stepLines.length, 18);
    assert.equal(plan.sectionSurfaces.filter((s) => s.kind === "tread").at(-1)?.elevationRatio, 1);
    assert.equal(plan.footprint.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), true);
  });
  test("offset places a straight flight on the chosen side", () => {
    const straight = { ...stair, pathPoints: [stair.a, { x: 400, y: 0 }] };
    const left = stairPlanGeometry({ ...straight, offsetSide: "left" }, 100);
    const right = stairPlanGeometry({ ...straight, offsetSide: "right" }, 100);
    assert.equal(Math.max(...left.footprint.map((p) => p.y)), 0);
    assert.equal(Math.min(...right.footprint.map((p) => p.y)), 0);
  });
  test("move, rotate and file normalization preserve every bend", () => {
    const moved = translateStair(stair, 30, 40);
    assert.deepEqual(moved.pathPoints?.[1], { x: 430, y: 40 });
    const rotated = rotateStair(stair, 90);
    assert.ok(Math.abs(rotated.pathPoints?.[1].x ?? 1) < 1e-6);
    assert.equal(rotated.pathPoints?.[1].y, 400);
    const saved = normalizeStairs(JSON.parse(JSON.stringify([moved])), new Set(["L1", "L2"]));
    assert.deepEqual(saved[0].pathPoints, moved.pathPoints);
    assert.equal(saved[0].kind, "bebas");
  });
  test("riser and tread use actual height and flight run, excluding landings", () => {
    const metrics = stairMetrics(stair, [{ id: "L1", mdpl: 0 }, { id: "L2", mdpl: 3.6 }], 100);
    assert.equal(metrics.riserM, 0.2);
    assert.equal(metrics.treadM, 6.8 / 18);
  });
});