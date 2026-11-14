import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRksHtml, buildRksMhtml, rksPasalList, RKS_FONT_FAMILY, RKS_FONT_SIZE_PT } from "./rks-document";
import type { LibraryMaterial } from "./material-library";

const mat = (id: string, kind: LibraryMaterial["kind"], name: string, rks = ""): LibraryMaterial => ({ id, kind, name, image: null, description: "", product: "", code: "", rks });
const materials = [
  mat("f1", "fasad", "ACP Abu"),
  mat("p1", "plafon", "Gypsum 9 mm"),
  mat("d1", "dinding", "Cat Tembok"),
  mat("l1", "lantai", "Granit 60x60", "Granit dipasang dengan nat 2 mm."),
  mat("b1", "pekerjaan dasar", "Beton K-300"),
];
const square = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }];
const sketch = {
  scale: "1:100",
  levels: [{ id: "lv1", name: "Lantai 1", mdpl: 0 }],
  layers: [{ name: "R. Tamu", points: square, areaM2: 1, levelId: "lv1", roomMaterials: { plafon: "p1", dinding: "d1", lantai: "l1" } }],
  lines: [],
  generalMaterials: { foundation: ["b1"], facades: { barat: ["f1"], timur: [], utara: [], selatan: [] } },
};
const input = { projectTitle: "Gedung Theranostic", dateLabel: "November 2026", overview: [{ label: "Nama Proyek", value: "Gedung Theranostic" }], levels: [], sketch, materials };

test("pasal follow Outline Spesifikasi order: dasar, lantai, dinding, plafon, fasad", () => {
  assert.deepEqual(rksPasalList(sketch, materials).map((p) => p.ref.kind), ["pekerjaan dasar", "lantai", "dinding", "plafon", "fasad"]);
  assert.deepEqual(rksPasalList(sketch, materials).map((p) => p.number), [1, 2, 3, 4, 5]);
});

test("cover uses the project title and the table of contents links every pasal", () => {
  const { html } = buildRksHtml(input);
  assert.ok(html.includes("GEDUNG THERANOSTIC"));
  for (const pasal of rksPasalList(sketch, materials)) {
    assert.ok(html.includes(`href="#${pasal.anchor}"`), pasal.title);
    assert.ok(html.includes(`<a name="${pasal.anchor}"></a>`), pasal.title);
  }
});

test("document text uses Times New Roman 11 pt", () => {
  assert.equal(RKS_FONT_FAMILY, "Times New Roman");
  assert.equal(RKS_FONT_SIZE_PT, 11);
  assert.ok(buildRksHtml(input).html.includes('font-size:11.0pt'));
});

test("material RKS narrative is written inside its pasal", () => {
  const { html } = buildRksHtml(input);
  const pasal = html.indexOf("Pasal 2 — Granit 60x60");
  assert.ok(pasal > 0 && html.indexOf("Granit dipasang dengan nat 2 mm.") > pasal);
});

test("Word file embeds image parts next to the HTML", () => {
  const withImage = { ...input, codeImages: new Map([["lantai:L1", { mime: "image/png", base64: "iVBORw0KGgo=", width: 30, height: 30 }]]) };
  const file = buildRksMhtml(withImage);
  assert.ok(file.startsWith("MIME-Version: 1.0"));
  assert.ok(file.includes("Content-Location: file:///C:/RKS/rks_files/image001.png"));
});
