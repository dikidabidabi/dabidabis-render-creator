import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SECTION3D_BEAM_HEIGHT_M, clipPrismsToSection, majorityArchitecturalStyle, mergeCutFaces,
  section3dBeams, section3dFloors, section3dFrame, sectionCutFaces,
} from "./section-3d";
import type { Detail3dPrism } from "./level-detail-3d";
import type { StructuralGrid } from "./structural-grid";

const box = (x0: number, y0: number, x1: number, y1: number, kind: Detail3dPrism["kind"] = "wall"): Detail3dPrism => ({
  kind, outer: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], holes: [], bottom: 0, top: 3,
});
const area = (ring: Array<{ x: number; y: number }>) => Math.abs(ring.reduce((s, p, i) => {
  const q = ring[(i + 1) % ring.length]!;
  return s + p.x * q.y - q.x * p.y;
}, 0) / 2);

test("arah pandang mengikuti panah garis potong: kanan dari awal ke akhir", () => {
  // Garis dari kiri ke kanan (px, 100 px/m) → pandang ke +y kanvas (ke bawah layar).
  const frame = section3dFrame({ x: 0, y: 500 }, { x: 1000, y: 500 }, 100)!;
  assert.deepEqual({ nx: frame.n.x, ny: frame.n.y, len: frame.length }, { nx: -0, ny: 1, len: 10 });
});

test("bagian di depan garis potong dibuang, bagian belakang dipertahankan dan terbelah", () => {
  const frame = section3dFrame({ x: 0, y: 500 }, { x: 1000, y: 500 }, 100)!;
  const kept = clipPrismsToSection([box(1, 0, 3, 10), box(6, 0, 7, 2), box(8, 6, 9, 9)], frame);
  assert.equal(kept.length, 2);
  assert.equal(area(kept[0]!.outer), 2 * 5); // 2 m × (10 − 5) m tersisa
  assert.equal(area(kept[1]!.outer), 3);     // utuh di belakang bidang
});

test("sisi terbelah tercatat sebagai bidang potong selebar ketebalan dinding", () => {
  const frame = section3dFrame({ x: 0, y: 500 }, { x: 1000, y: 500 }, 100)!;
  const faces = sectionCutFaces(clipPrismsToSection([box(2, 0, 2.15, 10)], frame), frame);
  assert.equal(faces.length, 1);
  assert.ok(Math.abs(faces[0]!.s1 - faces[0]!.s0 - 0.15) < 1e-6);
  assert.deepEqual([faces[0]!.bottom, faces[0]!.top], [0, 3]);
});

test("balok: 40 cm di as grid dan 20 cm di tepi plat, tinggi 70 cm di bawah plat 150 mm", () => {
  const grid = { enabled: true, origin: { x: 500, y: 0 }, spansX: [], spansY: [], rotation: 0, lineOnly: true } as unknown as StructuralGrid;
  const beams = section3dBeams([{ outer: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], thicknessMm: 150 }], [grid], 100);
  const total = beams.reduce((s, b) => s + area(b.outer) - b.holes.reduce((h, r) => h + area(r), 0), 0);
  // Tepi: 10×10 − 9.6×9.6 = 7.84 m²; as tengah 0.4 × 9.6 = 3.84 m².
  assert.ok(Math.abs(total - (7.84 + 3.84)) < 1e-3, `luas balok ${total}`);
  for (const b of beams) assert.deepEqual([b.top, b.bottom], [-0.15, -0.15 - SECTION3D_BEAM_HEIGHT_M]);
});

test("plat + balok tergabung menjadi satu siluet potong", () => {
  const merged = mergeCutFaces([
    { s0: 0, s1: 10, bottom: -0.15, top: 0 },
    { s0: 4.8, s1: 5.2, bottom: -0.85, top: -0.15 },
  ]);
  assert.equal(merged.length, 1);
});

test("lantai tipikal disalin pada elevasi masing-masing", () => {
  const floors = section3dFloors([{ id: "b", name: "Tipikal", mdpl: 4, typicalCount: 3, typicalHeight: 3.5 }, { id: "a", name: "Dasar", mdpl: 0 }, { id: "c", name: "Atap", mdpl: 8 }]);
  assert.deepEqual(floors.map((f) => [f.key, f.base, f.height]), [["a", 0, 4], ["b__t0", 4, 3.5], ["b__t1", 7.5, 3.5], ["b__t2", 11, 3.5], ["c", 15, 4]]);
});

test("style potongan 3D mengikuti mayoritas detail arsitektural, bawaan Tosca", () => {
  assert.equal(majorityArchitecturalStyle([]), "tosca");
  assert.equal(majorityArchitecturalStyle([{ showArchitectural: false, architecturalStyle: "bata" }]), "tosca");
  assert.equal(majorityArchitecturalStyle([
    { showArchitectural: true, architecturalStyle: "blue" },
    { showArchitectural: true, architecturalStyle: "bata" },
    { showArchitectural: true, architecturalStyle: "bata" },
    { showArchitectural: false, architecturalStyle: "blue" },
  ]), "bata");
});

test("plafon potongan 3D: papan 5 mm di +2,8 m, rangka hollow 2×4 @40 cm dan 4×4 @120 cm bersilangan, hanya di bawah plat atas, tanpa lift/shaft/tangga", async () => {
  const { section3dCeilings } = await import("./section-3d");
  const sq = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const ppm = 100;
  const rooms = [
    { name: "Kantor", points: sq(0, 0, 1000, 600) },
    { name: "Lift Penumpang", points: sq(1000, 0, 1200, 200) },
    { name: "Shaft MEP", points: sq(1000, 200, 1200, 400) },
    { name: "Tangga Darurat", points: sq(1000, 400, 1200, 600) },
  ];
  // Plat atas hanya menutup separuh kantor (x 0–5 m) dan seluruh area inti.
  const slabsAbove = [{ outer: sq(0, 0, 500, 600), thicknessMm: 150 }, { outer: sq(1000, 0, 1200, 600), thicknessMm: 150 }];
  const parts = section3dCeilings(rooms, slabsAbove, ppm, 4);
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  const board = parts.filter((p) => p.kind === "ceiling");
  assert.equal(board.length, 1);
  assert.deepEqual([r(board[0]!.bottom), r(board[0]!.top)], [2.8, 2.805]);
  assert.ok(Math.abs(area(board[0]!.outer) - 30) < 1e-6); // 5 m × 6 m yang tertutup plat
  const frames = parts.filter((p) => p.kind === "ceilingFrame");
  const furring = frames.filter((p) => r(p.bottom) === 2.805);
  const runner = frames.filter((p) => r(p.bottom) === 2.825);
  assert.equal(furring.length + runner.length, frames.length);
  for (const p of furring) assert.equal(r(p.top), 2.825); // tinggi 2 cm
  for (const p of runner) assert.equal(r(p.top), 2.865); // tinggi 4 cm
  // 2×4 sejajar sisi panjang ruang (sumbu x), @40 cm melintang 6 m → 15 batang, lebar 4 cm × 5 m.
  assert.equal(furring.length, 15);
  const ys = furring.map((p) => r((Math.min(...p.outer.map((q) => q.y)) + Math.max(...p.outer.map((q) => q.y))) / 2)).sort((a, b) => a - b);
  assert.ok(Math.abs(ys[1]! - ys[0]! - 0.4) < 1e-6);
  for (const p of furring) assert.ok(Math.abs(area(p.outer) - 0.04 * 5) < 1e-6);
  // 4×4 tegak lurus (sumbu y), @120 cm sepanjang 5 m → 4 batang, lebar 4 cm × 6 m.
  assert.equal(runner.length, 4);
  const xs = runner.map((p) => r((Math.min(...p.outer.map((q) => q.x)) + Math.max(...p.outer.map((q) => q.x))) / 2)).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[1]! - xs[0]! - 1.2) < 1e-6);
  for (const p of runner) assert.ok(Math.abs(area(p.outer) - 0.04 * 6) < 1e-6);
  // Tanpa plat di atas → tanpa plafon.
  assert.equal(section3dCeilings(rooms, [], ppm, 4).length, 0);
});
