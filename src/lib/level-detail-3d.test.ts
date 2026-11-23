import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLevelDetail3d, levelWallHeight, type Detail3dInput } from "./level-detail-3d";
import { edgeMaterialKey } from "./edge-segments";

const PPM = 100; // 100 px = 1 m
const L = "lv1";
const wall = (ax: number, ay: number, bx: number, by: number) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, kind: "straight" as const, levelId: L });
const base = (over: Partial<Detail3dInput> = {}): Detail3dInput => ({
  pxPerMeter: PPM, levelId: L, lines: [], edgeAttrs: {}, rooms: [], doors: [], windows: [], wallHeight: 3.5, ...over,
});
const depthOf = (ring: { y: number }[]) => Math.max(...ring.map((p) => p.y)) - Math.min(...ring.map((p) => p.y));

test("tinggi dinding = selisih MDPL ke level di atasnya", () => {
  const levels = [{ id: "a", mdpl: 0 }, { id: "b", mdpl: 3.5 }, { id: "c", mdpl: 7.5 }];
  assert.equal(levelWallHeight(levels, "a"), 3.5);
  assert.equal(levelWallHeight(levels, "b"), 4);
});

test("level tipikal memakai tinggi tiap lantai tipikal", () => {
  const levels = [{ id: "a", mdpl: 0, typicalCount: 3, typicalHeight: 3.2 }, { id: "b", mdpl: 3 }];
  assert.equal(levelWallHeight(levels, "a"), 3.2);
});

test("dinding beton 300 mm setinggi level dan setebal 300 mm", () => {
  const line = wall(0, 0, 500, 0);
  const model = buildLevelDetail3d(base({ lines: [line], edgeAttrs: { [edgeMaterialKey(L, line.a, line.b)]: "concrete300" } }));
  const walls = model.prisms.filter((p) => p.kind === "concrete");
  assert.equal(walls.length, 1);
  assert.equal(walls[0]!.top, 3.5);
  assert.ok(Math.abs(depthOf(walls[0]!.outer) - 0.3) < 1e-6);
});

test("garis tanpa material tidak menjadi dinding", () => {
  const model = buildLevelDetail3d(base({ lines: [wall(0, 0, 500, 0)] }));
  assert.equal(model.prisms.length, 0);
});

test("pintu membuka dinding sampai 2,1 m dan menyisakan ambang di atasnya", () => {
  const line = wall(0, 0, 500, 0);
  const door = { a: { x: 200, y: 0 }, b: { x: 290, y: 0 }, nx: 0, ny: 1, leaves: 1 as const, widthCm: 90 };
  const model = buildLevelDetail3d(base({ lines: [line], edgeAttrs: { [edgeMaterialKey(L, line.a, line.b)]: "solid" }, doors: [door] }));
  const walls = model.prisms.filter((p) => p.kind === "wall");
  assert.equal(walls.filter((p) => p.bottom === 0 && p.top === 3.5).length, 2); // dinding terbelah
  assert.equal(walls.filter((p) => p.bottom === 2.1 && p.top === 3.5).length, 1);
  assert.equal(model.prisms.filter((p) => p.kind === "door").length, 1);
});

test("jendela menyisakan dinding di bawah ambang 0,9 m dan di atas 2,1 m serta kaca di antaranya", () => {
  const line = wall(0, 0, 500, 0);
  const win = { id: "w", a: { x: 100, y: 0 }, b: { x: 250, y: 0 }, nx: 0, ny: 1, leaves: 2, widthCm: 150 };
  const model = buildLevelDetail3d(base({ lines: [line], edgeAttrs: { [edgeMaterialKey(L, line.a, line.b)]: "solid" }, windows: [win] }));
  const walls = model.prisms.filter((p) => p.kind === "wall");
  assert.ok(walls.some((p) => p.bottom === 0 && p.top === 0.9));
  assert.ok(walls.some((p) => p.bottom === 2.1 && p.top === 3.5));
  assert.ok(model.prisms.some((p) => p.kind === "glass" && p.bottom === 0.9 && p.top === 2.1));
});

test("ruang menjadi lantai, lahan diabaikan", () => {
  const square = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  const model = buildLevelDetail3d(base({ rooms: [{ name: "Kamar", points: square, color: "#ff0000" }, { name: "Lahan", points: square, color: "#000" }] }));
  const floors = model.prisms.filter((p) => p.kind === "floor");
  assert.equal(floors.length, 1);
  assert.equal(model.bounds?.maxX, 4);
});

test("kolom struktur grid tampil setinggi level dan memotong dinding", async () => {
  const { detail3dColumnRings } = await import("./level-detail-3d");
  const grid = { enabled: true, origin: { x: 0, y: 0 }, rotation: 0, spansX: [5], spansY: [4], colSizeCm: 50 };
  const rings = detail3dColumnRings([grid as any], L, [{ id: L, mdpl: 0 }], PPM);
  assert.equal(rings.length, 4);
  const line = wall(0, 0, 500, 0);
  const model = buildLevelDetail3d(base({ lines: [line], edgeAttrs: { [edgeMaterialKey(L, line.a, line.b)]: "solid" }, columns: rings }));
  const columns = model.prisms.filter((p) => p.kind === "column");
  assert.equal(columns.length, 4);
  assert.equal(model.counts.columns, 4);
  for (const c of columns) { assert.equal(c.bottom, 0); assert.equal(c.top, 3.5); }
  const xs = columns[0]!.outer.map((p) => p.x);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 0.5) < 1e-6);
  // Dinding tidak lagi menempati tapak kolom di ujungnya (x 0..0,25 m).
  const wallMinX = Math.min(...model.prisms.filter((p) => p.kind === "wall").flatMap((p) => p.outer.map((q) => q.x)));
  assert.ok(wallMinX >= 0.25 - 1e-6);
});

test("kolom di luar rentang level grid tidak ikut", async () => {
  const { detail3dColumnRings } = await import("./level-detail-3d");
  const grid = { enabled: true, origin: { x: 0, y: 0 }, rotation: 0, spansX: [5], spansY: [4], colSizeCm: 50, fromLevelId: "b", toLevelId: "b" };
  assert.equal(detail3dColumnRings([grid as any], "a", [{ id: "a", mdpl: 0 }, { id: "b", mdpl: 4 }], PPM).length, 0);
});

test("label ruang berbentuk L tetap berada di dalam ruang", async () => {
  const { roomLabelPoint } = await import("./level-detail-3d");
  const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 10 }, { x: 0, y: 10 }];
  const p = roomLabelPoint(ring);
  const inside = (p.x >= 0 && p.x <= 10 && p.y >= 0 && p.y <= 1) || (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 10);
  assert.ok(inside, JSON.stringify(p));
});

test("void pada alat Lantai melubangi lantai ruang dan bidang potongnya", async () => {
  const { section3dFrame, clipPrismsToSection, sectionCutFaces } = await import("./section-3d");
  const room = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 600 }, { x: 0, y: 600 }];
  const voidRing = [{ x: 400, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 400 }, { x: 400, y: 400 }];
  const model = buildLevelDetail3d(base({
    rooms: [{ name: "Lobi", points: room, color: "#ff0000" }],
    slabs: [{ outer: room, holes: [voidRing], thicknessMm: 150 }],
  }));
  const ringArea = (ring: { x: number; y: number }[]) => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]!; return s + p.x * q.y - q.x * p.y; }, 0) / 2);
  const solidArea = (kind: string) => model.prisms.filter((p) => p.kind === kind)
    .reduce((s, p) => s + ringArea(p.outer) - p.holes.reduce((h, r) => h + ringArea(r), 0), 0);
  // 10 × 6 m dikurangi void 2 × 2 m.
  assert.equal(Math.round(solidArea("floor") * 100) / 100, 56);
  assert.equal(Math.round(solidArea("slab") * 100) / 100, 56);
  // Garis potong melewati tengah void: lantai terbelah di s 0–4 m dan 6–10 m saja.
  const frame = section3dFrame({ x: 0, y: 300 }, { x: 1000, y: 300 }, PPM)!;
  const faces = sectionCutFaces(clipPrismsToSection(model.prisms, frame), frame).filter((f) => f.kind === "floor" || f.kind === "slab");
  assert.ok(faces.length > 0);
  assert.ok(faces.every((f) => f.s1 <= 4 + 1e-6 || f.s0 >= 6 - 1e-6));
});
