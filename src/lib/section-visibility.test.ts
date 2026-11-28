import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionVisibleLines } from "./section-visibility";
import { section3dFrame } from "./section-3d";
import type { Detail3dKind, Detail3dPrism } from "./level-detail-3d";
const frame = section3dFrame({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
assert.ok(frame);
const box = (kind: Detail3dKind, x0: number, x1: number, y0: number, y1: number, bottom: number, top: number): Detail3dPrism => ({ kind, outer: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], holes: [], bottom, top });
const wall = box("wall", 0, 10, 1, 1.2, 0, 3);
test("dinding menutup seluruh garis clading di belakangnya", () => {
  assert.deepEqual(sectionVisibleLines([wall, box("clading", 2, 8, 2, 2.2, 0.5, 2.5)], frame), sectionVisibleLines([wall], frame));
});
test("garis yang tidak terhalang dinding tetap tampil, bagian tertutup dihapus", () => {
  const lines = sectionVisibleLines([box("wall", 0, 5, 1, 1.2, 0, 3), box("clading", 2, 8, 2, 2.2, 0.5, 2.5)], frame);
  const horizontal = lines.filter(l => Math.abs(l.a.h - 2.5) < 1e-6 && Math.abs(l.b.h - 2.5) < 1e-6);
  assert.equal(horizontal.length, 1);
  assert.equal(horizontal[0]?.a.s, 5);
  assert.equal(horizontal[0]?.b.s, 8);
});
test("bukaan dinding dan kaca tidak menghalangi benda di belakang", () => {
  const lines = sectionVisibleLines([box("wall", 0, 3, 1, 1.2, 0, 3), box("wall", 7, 10, 1, 1.2, 0, 3), box("glass", 3, 7, 1, 1.2, 0, 3), box("clading", 4, 6, 2, 2.2, 0.5, 2.5)], frame);
  assert.ok(lines.some(l => l.a.s === 4 && l.b.s === 6 && l.a.h === 2.5 && l.b.h === 2.5));
});
test("benda di depan dinding tetap terlihat", () => {
  const lines = sectionVisibleLines([wall, box("clading", 2, 8, 0.2, 0.4, 0.5, 2.5)], frame);
  assert.ok(lines.some(l => l.a.s === 2 && l.b.s === 8 && l.a.h === 2.5 && l.b.h === 2.5));
});
test("garis proyeksi identik digabung dan tidak ditumpuk", () => {
  assert.deepEqual(sectionVisibleLines([wall, wall], frame), sectionVisibleLines([wall], frame));
});