import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_DEFS, PANEL_LAYOUTS, activePanelKeys, autoPanelLayout, defaultPanelItems, normalizeCompetitionPanels,
  panelContentCatalog, panelPaperPixels, panelSuggestions, panelTexts, panelLayoutById, type PanelSourceSketch,
} from "./competition-panels";

const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
  toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
  toBeGreaterThanOrEqual: (n: number) => assert.ok(Number(actual) >= n, `${String(actual)} < ${n}`),
  toHaveLength: (n: number) => assert.equal((actual as { length: number }).length, n),
});

const sk: PanelSourceSketch = {
  title: "Gedung Uji",
  levels: [
    { id: "L2", name: "Lantai 2", mdpl: 4, typicalCount: 3 },
    { id: "L1", name: "Lantai 1", mdpl: 0 },
  ],
  layers: [
    { name: "Lahan", areaM2: 1000, levelId: "L1" },
    { name: "Lobby", areaM2: 100, levelId: "L1" },
    { name: "Kamar", areaM2: 50, levelId: "L2" },
  ],
  sectionCuts: [{ label: "A-A", p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 } }],
};
const catalog = panelContentCatalog(sk, { perspektif: [{ id: "p1", title: "Eksterior" }] });

describe("Panel Sayembara", () => {
  it("memiliki tujuh panel bernama sesuai urutan", () => {
    expect(PANEL_DEFS.map((d) => d.name)).toEqual([
      "Konsep", "Denah", "Tampak", "Potongan", "Simulasi", "Perhitungan & Material", "Perspektif Eksterior & Interior",
    ]);
  });

  it("menyediakan setidaknya tujuh pilihan layout", () => {
    expect(PANEL_LAYOUTS.length).toBeGreaterThanOrEqual(7);
  });

  it("ceklis presentasi bawaan nonaktif", () => {
    expect(normalizeCompetitionPanels({})?.enabled).toBe(false);
    expect(activePanelKeys(normalizeCompetitionPanels({}))).toEqual([]);
    expect(activePanelKeys(normalizeCompetitionPanels({ enabled: true }))).toHaveLength(7);
  });

  it("Konsep memuat lokasi, kawasan, jarak site, kondisi site, dan kedekatan ruang", () => {
    expect(defaultPanelItems("konsep", catalog, sk)).toEqual(["site:lokasi", "site:lingkungan", "site:fasilitas", "site:akses", "bubble-total"]);
  });

  it("Denah memuat tiap lantai berurutan termasuk tipikal", () => {
    expect(defaultPanelItems("denah", catalog, sk)).toEqual(["lvl:L1", "lvl:L2"]);
    expect(catalog.find((c) => c.token === "lvl:L2")?.label).toBe("Denah Lantai 2 · Tipikal ×3");
  });

  it("Tampak memuat empat sisi dari proyeksi 3D", () => {
    expect(defaultPanelItems("tampak", catalog, sk)).toEqual(["tampak:selatan", "tampak:utara", "tampak:timur", "tampak:barat"]);
  });

  it("Potongan memuat potongan 3D, 2D, dan fungsi", () => {
    expect(defaultPanelItems("potongan", catalog, sk)).toEqual(["section3d:A-A", "section:A-A", "function-section:A-A"]);
  });

  it("Simulasi memuat bukaan, bayangan, matahari, iklim, angin, eksplode, dan fungsi", () => {
    expect(defaultPanelItems("simulasi", catalog, sk)).toEqual(["facade-zoning", "shadow-seasonal", "matahari", "thermal", "wind", "explode-axo", "stacking"]);
  });

  it("Perhitungan & Material memuat luasan, tabulasi, komposisi, biaya, dan spesifikasi", () => {
    expect(defaultPanelItems("perhitungan", catalog, sk)).toEqual(["rekap", "volumetrik", "komposisi", "biaya", "spec-outline"]);
  });

  it("Perspektif memuat gambar render", () => {
    expect(defaultPanelItems("perspektif", catalog, sk)).toEqual(["perspektif:p1"]);
  });

  it("layout otomatis membesar bila konten tidak muat", () => {
    expect(autoPanelLayout("tampak", 4).id).toBe("kuadran");
    expect(autoPanelLayout("tampak", 6).slots.length).toBeGreaterThanOrEqual(6);
  });

  it("teks hasil edit dipakai, teks kosong diisi otomatis", () => {
    const layout = panelLayoutById("fokus")!;
    const texts = panelTexts("perspektif", { texts: [{ title: "Judul saya", body: "Isi saya" }, null] }, layout, sk);
    expect(texts[0]).toEqual({ title: "Judul saya", body: "Isi saya" });
    expect(texts[1]?.title).toBe("Daftar Gambar");
  });

  it("sugesti mengeluarkan konten panel lain dan menambah isi bawaan yang hilang", () => {
    const layout = panelLayoutById("kuadran")!;
    const s = panelSuggestions("tampak", ["tampak:selatan", "wind"], layout, catalog, sk);
    expect(s.some((x) => x.kind === "remove" && x.token === "wind")).toBe(true);
    expect(s.some((x) => x.kind === "add" && x.token === "tampak:utara")).toBe(true);
  });

  it("ukuran kertas A1 dan A2 pada 150 dpi", () => {
    expect(panelPaperPixels("A1", "portrait")).toEqual({ w: 3508, h: 4967 });
    expect(panelPaperPixels("A2", "landscape")).toEqual({ w: 3508, h: 2480 });
  });
});
