import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRksHtml, buildRksMhtml, rksPasalList, RKS_FONT_FAMILY, RKS_FONT_SIZE_PT } from "./rks-document";
import type { LibraryMaterial, RksPasalDef } from "./material-library";
import type { RksDoc } from "./rks-content";

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
  assert.deepEqual(rksPasalList(sketch, materials).map((p) => p.kind), ["pekerjaan dasar", "lantai", "dinding", "plafon", "fasad"]);
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

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const li = (text: string, ...nested: object[]) => ({ type: "listItem", content: [p(text), ...nested] });
const ol = (...items: object[]) => ({ type: "orderedList", content: items });

test("materials sharing a pasal become one pasal with the narrative written once", () => {
  const shared: RksPasalDef = { id: "ps1", name: "Pekerjaan Cat", rks: "", rksDoc: { type: "doc", content: [p("Cat diaplikasikan dua lapis.")] } as RksDoc };
  const withPasal = materials.map((m) => m.id === "d1" || m.id === "p1" ? { ...m, pasalId: "ps1" } : m);
  const list = rksPasalList(sketch, withPasal, [shared]);
  assert.deepEqual(list.map((x) => x.title), ["Pasal 1 — Beton K-300", "Pasal 2 — Granit 60x60", "Pasal 3 — Pekerjaan Cat", "Pasal 4 — ACP Abu"]);
  assert.deepEqual(list[2].items.map((x) => x.material.id), ["d1", "p1"]);
  const { html } = buildRksHtml({ ...input, materials: withPasal, pasals: [shared] });
  assert.equal(html.split("Cat diaplikasikan dua lapis.").length - 1, 1);
});

test("paragraph numbering has 3 levels prefixed by the pasal number in document order", () => {
  const doc = { type: "doc", content: [ol(li("Persyaratan Bahan", ol(li("Semen", ol(li("Tipe I"))), li("Pasir"))), li("Pelaksanaan"))] } as RksDoc;
  const withDoc = materials.map((m) => m.id === "d1" ? { ...m, rksDoc: doc } : m);
  const { html } = buildRksHtml({ ...input, materials: withDoc });
  // Cat Tembok is pasal 3; butir 1–3 are Lingkup, Produk, Deskripsi.
  for (const label of ["3.1.", "3.4.", "3.4.1.", "3.4.1.1.", "3.4.2.", "3.5."]) assert.ok(html.includes(`>${label}<span`), label);
  assert.ok(html.indexOf("3.4.1.1.") < html.indexOf("3.4.2."));
  assert.ok(!html.includes("3.4.<span style='mso-tab-count:1'>&nbsp;&nbsp;</span>Persyaratan Teknis"));
});

test("sub-points and tables are indented under their numbered point", () => {
  const table = { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p("Uji")] }, { type: "tableCell", content: [p("Slump 10 cm")] }] }] };
  const doc = { type: "doc", content: [ol({ type: "listItem", content: [p("Pengujian"), { type: "bulletList", content: [li("Uji tekan")] }, table] })] } as RksDoc;
  const { html } = buildRksHtml({ ...input, materials: materials.map((m) => m.id === "b1" ? { ...m, rksDoc: doc } : m) });
  assert.ok(html.includes("<p class=MsoRksH36x18>a.<span"));
  assert.ok(html.includes("p.MsoRksH36x18 { margin:0cm; margin-left:54.0pt; text-indent:-18.0pt;"));
  assert.ok(html.includes("margin-left:36pt;border-collapse:collapse"));
  assert.ok(html.includes("Slump 10 cm"));
});
