// Panel Sayembara: tujuh panel bernama (Konsep … Perspektif) yang menyusun
// konten proyek ke dalam layout pilihan. Modul ini murni (tanpa React/DOM)
// agar katalog konten, isi bawaan, layout, teks dan sugesti bisa diuji, dan
// dipakai bersama oleh alat Sketsa, slide Presentasi, serta ekspor PSD.

export type PanelKey = "konsep" | "denah" | "tampak" | "potongan" | "simulasi" | "perhitungan" | "perspektif";
export type PanelPaper = "A1" | "A2";
export type PanelOrientation = "portrait" | "landscape";

export type PanelDef = { key: PanelKey; name: string; hint: string; preferredLayout: string };

export const PANEL_DEFS: PanelDef[] = [
  { key: "konsep", name: "Konsep", hint: "Konteks lokasi, kawasan, jarak site, kondisi site dan kedekatan ruang.", preferredLayout: "majalah" },
  { key: "denah", name: "Denah", hint: "Denah tiap lantai dan lantai tipikal.", preferredLayout: "strip" },
  { key: "tampak", name: "Tampak", hint: "Tampak empat sisi dari proyeksi model 3D.", preferredLayout: "kuadran" },
  { key: "potongan", name: "Potongan", hint: "Potongan 3D, potongan 2D dan potongan fungsi.", preferredLayout: "utama-grid" },
  { key: "simulasi", name: "Simulasi", hint: "Bukaan, bayangan, matahari, iklim, angin, diagram eksplode dan diagram fungsi.", preferredLayout: "mosaik" },
  { key: "perhitungan", name: "Perhitungan & Material", hint: "Luasan, tabulasi, komposisi ruang, biaya dan spesifikasi material.", preferredLayout: "majalah" },
  { key: "perspektif", name: "Perspektif Eksterior & Interior", hint: "Gambar render dan kotak penjelasan.", preferredLayout: "fokus" },
];

export const PANEL_KEYS: PanelKey[] = PANEL_DEFS.map((d) => d.key);
export function panelDef(key: PanelKey): PanelDef {
  return PANEL_DEFS.find((d) => d.key === key) ?? PANEL_DEFS[0]!;
}

// ---------- Layout ----------
/** Persegi dalam pecahan bidang isi panel (0..1), di bawah kepala panel. */
export type PanelRect = { x: number; y: number; w: number; h: number };
export type PanelLayout = { id: string; name: string; description: string; slots: PanelRect[]; texts: PanelRect[] };

const GAP = 0.015;
function grid(cols: number, rows: number, x: number, y: number, w: number, h: number, gap = GAP): PanelRect[] {
  const cw = (w - gap * (cols - 1)) / cols;
  const rh = (h - gap * (rows - 1)) / rows;
  const out: PanelRect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: x + c * (cw + gap), y: y + r * (rh + gap), w: cw, h: rh });
  return out;
}

export const PANEL_LAYOUTS: PanelLayout[] = [
  { id: "utama-grid", name: "Utama + Grid", description: "1 gambar utama lebar, 3 gambar pendukung, teks di bawah.",
    slots: [{ x: 0, y: 0, w: 1, h: 0.5 }, ...grid(3, 1, 0, 0.515, 1, 0.27)], texts: [{ x: 0, y: 0.8, w: 1, h: 0.2 }] },
  { id: "kuadran", name: "Kuadran 2×2", description: "4 gambar sama besar, teks di bawah.",
    slots: grid(2, 2, 0, 0, 1, 0.8), texts: [{ x: 0, y: 0.815, w: 1, h: 0.185 }] },
  { id: "grid-2x3", name: "Grid 2×3", description: "6 gambar dua kolom, teks di bawah.",
    slots: grid(2, 3, 0, 0, 1, 0.82), texts: [{ x: 0, y: 0.835, w: 1, h: 0.165 }] },
  { id: "grid-2x4", name: "Grid 2×4", description: "8 gambar dua kolom, teks di bawah.",
    slots: grid(2, 4, 0, 0, 1, 0.84), texts: [{ x: 0, y: 0.855, w: 1, h: 0.145 }] },
  { id: "grid-3x3", name: "Grid 3×3", description: "9 gambar rapat, teks di bawah.",
    slots: grid(3, 3, 0, 0, 1, 0.84), texts: [{ x: 0, y: 0.855, w: 1, h: 0.145 }] },
  { id: "majalah", name: "Majalah", description: "Gambar utama kiri, gambar dan teks di kanan, 3 gambar di bawah.",
    slots: [{ x: 0, y: 0, w: 0.64, h: 0.58 }, { x: 0.655, y: 0, w: 0.345, h: 0.285 }, ...grid(3, 1, 0, 0.6, 1, 0.4)],
    texts: [{ x: 0.655, y: 0.3, w: 0.345, h: 0.28 }] },
  { id: "dua-kolom", name: "Dua Kolom", description: "3 gambar kiri, teks dan 3 gambar kanan.",
    slots: [...grid(1, 3, 0, 0, 0.49, 1), ...grid(1, 3, 0.51, 0.235, 0.49, 0.765)], texts: [{ x: 0.51, y: 0, w: 0.49, h: 0.22 }] },
  { id: "strip", name: "Strip Bertingkat", description: "4 gambar bertumpuk, kolom teks di kanan.",
    slots: grid(1, 4, 0, 0, 0.68, 1), texts: [{ x: 0.695, y: 0, w: 0.305, h: 0.6 }, { x: 0.695, y: 0.615, w: 0.305, h: 0.385 }] },
  { id: "mosaik", name: "Mosaik", description: "7 gambar beragam ukuran dan 1 kotak teks.",
    slots: [
      { x: 0, y: 0, w: 0.6, h: 0.4 }, { x: 0.615, y: 0, w: 0.385, h: 0.1925 }, { x: 0.615, y: 0.2075, w: 0.385, h: 0.1925 },
      ...grid(3, 1, 0, 0.415, 1, 0.25), { x: 0, y: 0.68, w: 0.6, h: 0.32 },
    ],
    texts: [{ x: 0.615, y: 0.68, w: 0.385, h: 0.32 }] },
  { id: "fokus", name: "Fokus Tunggal", description: "1 gambar besar, 2 gambar kecil, 2 kotak penjelasan.",
    slots: [{ x: 0, y: 0, w: 1, h: 0.6 }, ...grid(2, 1, 0, 0.615, 0.66, 0.385)],
    texts: [{ x: 0.675, y: 0.615, w: 0.325, h: 0.22 }, { x: 0.675, y: 0.85, w: 0.325, h: 0.15 }] },
];

export function panelLayoutById(id: string | undefined): PanelLayout | undefined {
  return PANEL_LAYOUTS.find((l) => l.id === id);
}

/** Layout bawaan: layout favorit panel bila muat; jika tidak, layout terkecil yang muat. */
export function autoPanelLayout(key: PanelKey, count: number): PanelLayout {
  const preferred = panelLayoutById(panelDef(key).preferredLayout)!;
  if (count <= preferred.slots.length) return preferred;
  const fits = PANEL_LAYOUTS.filter((l) => l.slots.length >= count).sort((a, b) => a.slots.length - b.slots.length);
  return fits[0] ?? panelLayoutById("grid-3x3")!;
}

export function panelLayoutFor(key: PanelKey, cfg: CompetitionPanelConfig | undefined, count: number): PanelLayout {
  return panelLayoutById(cfg?.layoutId) ?? autoPanelLayout(key, count);
}

// ---------- Kertas & halaman ----------
export const PANEL_PAPER_MM: Record<PanelPaper, { w: number; h: number }> = { A1: { w: 594, h: 841 }, A2: { w: 420, h: 594 } };
export const PANEL_PSD_DPI = 150;

export function panelPaperPixels(paper: PanelPaper, orientation: PanelOrientation, dpi = PANEL_PSD_DPI) {
  const mm = PANEL_PAPER_MM[paper];
  const short = Math.round((mm.w / 25.4) * dpi);
  const long = Math.round((mm.h / 25.4) * dpi);
  return orientation === "landscape" ? { w: long, h: short } : { w: short, h: long };
}

export type PanelBox = { x: number; y: number; w: number; h: number };
export type PanelPageGeometry = { margin: number; header: PanelBox; footer: PanelBox; body: PanelBox; slots: PanelBox[]; texts: PanelBox[]; unit: number };

/** Geometri halaman panel dalam satuan absolut (px) untuk lebar × tinggi apa pun. */
export function panelPageGeometry(layout: PanelLayout, width: number, height: number): PanelPageGeometry {
  const unit = Math.min(width, height) / 1000; // 1 unit desain = 1/1000 sisi pendek
  const margin = 36 * unit;
  const headerH = 92 * unit;
  const footerH = 30 * unit;
  const header = { x: margin, y: margin, w: width - margin * 2, h: headerH };
  const footer = { x: margin, y: height - margin - footerH, w: width - margin * 2, h: footerH };
  const body = { x: margin, y: header.y + headerH + 18 * unit, w: width - margin * 2, h: footer.y - 14 * unit - (header.y + headerH + 18 * unit) };
  const map = (r: PanelRect): PanelBox => ({ x: body.x + r.x * body.w, y: body.y + r.y * body.h, w: r.w * body.w, h: r.h * body.h });
  return { margin, header, footer, body, slots: layout.slots.map(map), texts: layout.texts.map(map), unit };
}

// ---------- Pengaturan tersimpan ----------
export type PanelText = { title: string; body: string };
export type CompetitionPanelConfig = {
  /** Panel ikut dibuat (bawaan aktif). */
  include?: boolean;
  layoutId?: string;
  /** Urutan konten (token). Kosong/undefined = isi bawaan dari proyek. */
  items?: string[];
  /** Teks per kotak teks layout; null = teks otomatis dari proyek. */
  texts?: Array<PanelText | null>;
  title?: string;
};
export type CompetitionPanelSettings = {
  /** Ceklis "Tampilkan di Presentasi" (bawaan nonaktif). */
  enabled: boolean;
  paper: PanelPaper;
  orientation: PanelOrientation;
  panels: Partial<Record<PanelKey, CompetitionPanelConfig>>;
};

export const DEFAULT_PANEL_SETTINGS: CompetitionPanelSettings = { enabled: false, paper: "A1", orientation: "portrait", panels: {} };

function normText(t: unknown): PanelText | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Record<string, unknown>;
  return { title: typeof o["title"] === "string" ? o["title"] : "", body: typeof o["body"] === "string" ? o["body"] : "" };
}

export function normalizeCompetitionPanels(raw: unknown): CompetitionPanelSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const panelsRaw = (o["panels"] && typeof o["panels"] === "object" ? o["panels"] : {}) as Record<string, unknown>;
  const panels: Partial<Record<PanelKey, CompetitionPanelConfig>> = {};
  for (const key of PANEL_KEYS) {
    const p = panelsRaw[key];
    if (!p || typeof p !== "object") continue;
    const c = p as Record<string, unknown>;
    const cfg: CompetitionPanelConfig = {};
    if (c["include"] === false) cfg.include = false;
    if (typeof c["layoutId"] === "string" && panelLayoutById(c["layoutId"])) cfg.layoutId = c["layoutId"];
    if (Array.isArray(c["items"])) cfg.items = (c["items"] as unknown[]).filter((x): x is string => typeof x === "string");
    if (Array.isArray(c["texts"])) cfg.texts = (c["texts"] as unknown[]).map(normText);
    if (typeof c["title"] === "string" && c["title"].trim()) cfg.title = c["title"];
    panels[key] = cfg;
  }
  return {
    enabled: o["enabled"] === true,
    paper: o["paper"] === "A2" ? "A2" : "A1",
    orientation: o["orientation"] === "landscape" ? "landscape" : "portrait",
    panels,
  };
}

// ---------- Katalog konten proyek ----------
export type PanelSourceSketch = {
  title?: string;
  levels?: Array<{ id: string; name: string; mdpl: number; typicalCount?: number }>;
  layers?: Array<{ name: string; areaM2: number; levelId?: string; coefficient?: number; hidden?: boolean; isReferenceRoom?: boolean; points?: Array<{ x: number; y: number }> }>;
  scale?: string;
  sectionCuts?: Array<{ label?: string; p1?: unknown; p2?: unknown }>;
  geo?: { lat: number; lon: number; label?: string };
  linkedMasterplan?: { rootLayerId: string } | undefined;
  illustrations?: unknown[];
  showSpecOutlineSlide?: boolean;
  showFurnitureSlide?: boolean;
  kdbPct?: number;
  klbCoef?: number;
  fungsi?: string;
  northRotation?: number;
};
export type PanelCatalogExtras = {
  narasi?: Array<{ id: string; text: string }>;
  perspektif?: Array<{ id: string; title: string }>;
  hasMoodboard?: boolean;
};
export type PanelContentItem = { token: string; label: string; group: PanelKey };

export const TAMPAK_DIRS = ["selatan", "utara", "timur", "barat"] as const;
export type TampakDir = (typeof TAMPAK_DIRS)[number];
export const TAMPAK_LABEL: Record<TampakDir, string> = { selatan: "Tampak Selatan", utara: "Tampak Utara", timur: "Tampak Timur", barat: "Tampak Barat" };

export function sortedPanelLevels(sk: PanelSourceSketch) {
  return [...(sk.levels ?? [])].sort((a, b) => (Number(a.mdpl) || 0) - (Number(b.mdpl) || 0));
}
export function panelCutLabels(sk: PanelSourceSketch): string[] {
  return (sk.sectionCuts ?? []).map((c, i) => (c?.p1 && c?.p2 ? c.label || `Potongan ${i + 1}` : null)).filter((x): x is string => !!x);
}

export const SIMULASI_ITEMS: Array<{ token: string; label: string }> = [
  { token: "facade-zoning", label: "Simulasi Bukaan" },
  { token: "shadow-seasonal", label: "Simulasi Bayangan" },
  { token: "matahari", label: "Simulasi Matahari" },
  { token: "thermal", label: "Simulasi Iklim (Thermal)" },
  { token: "wind", label: "Simulasi Angin" },
  { token: "explode-axo", label: "Diagram Eksplode" },
  { token: "stacking", label: "Diagram Fungsi" },
];

export function panelContentCatalog(sk: PanelSourceSketch, extras: PanelCatalogExtras = {}): PanelContentItem[] {
  const out: PanelContentItem[] = [];
  const add = (token: string, label: string, group: PanelKey) => out.push({ token, label, group });
  const levels = sortedPanelLevels(sk);
  // Konsep
  add("site:lokasi", "Konteks Lokasi", "konsep");
  if (sk.linkedMasterplan) {
    add("analisis-kawasan", "Analisis Kawasan", "konsep");
    add("masterplan", "Master Plan Kawasan", "konsep");
    add("siteplan", "Siteplan Kawasan", "konsep");
  }
  add("site:lingkungan", "Kawasan · Blue–Green & Lalu Lintas", "konsep");
  add("site:fasilitas", "Jarak Site & Fasilitas Sekitar", "konsep");
  add("site:akses", "Kondisi Site · Akses & Sirkulasi", "konsep");
  if ((sk.illustrations ?? []).length > 0) add("analisis-site", "Analisis Kondisi Site", "konsep");
  if (levels.length > 1) add("bubble-total", "Kedekatan Ruang · Semua Lantai", "konsep");
  for (const lv of levels) add(`bubble:${lv.id}`, `Kedekatan Ruang · ${lv.name}`, "konsep");
  (extras.narasi ?? []).forEach((n, i) => add(`konsep:${i}`, (extras.narasi ?? []).length > 1 ? `Narasi Konsep ${i + 1}` : "Narasi Konsep", "konsep"));
  // Denah
  for (const lv of levels) {
    const k = Math.max(1, Math.round(Number(lv.typicalCount) || 1));
    add(`lvl:${lv.id}`, k > 1 ? `Denah ${lv.name} · Tipikal ×${k}` : `Denah ${lv.name}`, "denah");
  }
  if (levels.length > 1) add("detail-axo", "Detail Aksonometri", "denah");
  // Tampak
  for (const dir of TAMPAK_DIRS) add(`tampak:${dir}`, TAMPAK_LABEL[dir], "tampak");
  // Potongan
  const cuts = panelCutLabels(sk);
  for (const c of cuts) add(`section3d:${c}`, `Potongan 3D ${c}`, "potongan");
  for (const c of cuts) add(`section:${c}`, `Potongan ${c}`, "potongan");
  for (const c of cuts) add(`function-section:${c}`, `Potongan Fungsi ${c}`, "potongan");
  // Simulasi
  for (const s of SIMULASI_ITEMS) add(s.token, s.label, "simulasi");
  // Perhitungan & material
  add("rekap", "Perhitungan Luasan", "perhitungan");
  add("volumetrik", "Tabulasi Volumetrik", "perhitungan");
  add("rincian", "Rincian per Level", "perhitungan");
  add("komposisi", "Komposisi Ruang", "perhitungan");
  add("infografis", "Infografis", "perhitungan");
  add("biaya", "Estimasi Biaya", "perhitungan");
  add("spec-outline", "Spesifikasi Material", "perhitungan");
  if (sk.showFurnitureSlide) add("furniture", "Furniture", "perhitungan");
  // Perspektif
  (extras.perspektif ?? []).forEach((p, i) => add(`perspektif:${p.id}`, p.title.trim() || `Perspektif ${i + 1}`, "perspektif"));
  if (extras.hasMoodboard) add("moodboard", "Moodboard", "perspektif");
  return out;
}

/** Isi bawaan tiap panel sesuai aturan sayembara. */
export function defaultPanelItems(key: PanelKey, catalog: PanelContentItem[], sk: PanelSourceSketch): string[] {
  const has = new Set(catalog.map((c) => c.token));
  const pick = (...tokens: Array<string | false | undefined>) => tokens.filter((t): t is string => !!t && has.has(t));
  const levels = sortedPanelLevels(sk);
  const cuts = panelCutLabels(sk);
  switch (key) {
    case "konsep":
      return pick(
        "site:lokasi",
        has.has("analisis-kawasan") ? "analisis-kawasan" : "site:lingkungan",
        "site:fasilitas",
        has.has("analisis-site") ? "analisis-site" : "site:akses",
        levels.length > 1 ? "bubble-total" : levels[0] && `bubble:${levels[0].id}`,
      );
    case "denah": return levels.map((lv) => `lvl:${lv.id}`).filter((t) => has.has(t));
    case "tampak": return TAMPAK_DIRS.map((d) => `tampak:${d}`);
    case "potongan": return [...cuts.map((c) => `section3d:${c}`), ...cuts.map((c) => `section:${c}`), ...cuts.map((c) => `function-section:${c}`)];
    case "simulasi": return SIMULASI_ITEMS.map((s) => s.token);
    case "perhitungan": return pick("rekap", "volumetrik", "komposisi", "biaya", "spec-outline");
    case "perspektif": return catalog.filter((c) => c.token.startsWith("perspektif:")).map((c) => c.token);
  }
}

export function panelItems(key: PanelKey, cfg: CompetitionPanelConfig | undefined, catalog: PanelContentItem[], sk: PanelSourceSketch): string[] {
  return cfg?.items ? [...cfg.items] : defaultPanelItems(key, catalog, sk);
}

export function panelIncluded(cfg: CompetitionPanelConfig | undefined): boolean {
  return cfg?.include !== false;
}

export function panelTitle(key: PanelKey, cfg: CompetitionPanelConfig | undefined): string {
  return cfg?.title?.trim() || panelDef(key).name;
}

// ---------- Teks penjelasan otomatis ----------
const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n : 0).toLocaleString("id-ID", { maximumFractionDigits: d, minimumFractionDigits: d });
const isSite = (n: string) => { const s = n.trim().toLowerCase(); return s.startsWith("lahan") || s === "void" || s.startsWith("taman"); };

export function panelProjectSummary(sk: PanelSourceSketch) {
  const layers = (sk.layers ?? []).filter((l) => !l.isReferenceRoom && !l.hidden);
  const levels = sortedPanelLevels(sk);
  const kOf = new Map(levels.map((lv) => [lv.id, Math.max(1, Math.round(Number(lv.typicalCount) || 1))]));
  const lahan = layers.filter((l) => l.name.trim().toLowerCase().startsWith("lahan")).reduce((s, l) => s + (Number(l.areaM2) || 0), 0);
  const rooms = layers.filter((l) => !isSite(l.name));
  const gross = rooms.reduce((s, l) => s + (Number(l.areaM2) || 0) * (kOf.get(l.levelId ?? "") ?? 1), 0);
  const effective = rooms.reduce((s, l) => s + (Number(l.areaM2) || 0) * (l.coefficient ?? 1) * (kOf.get(l.levelId ?? "") ?? 1), 0);
  const floors = levels.reduce((s, lv) => s + (kOf.get(lv.id) ?? 1), 0);
  const perLevel = levels.map((lv) => ({
    name: lv.name,
    k: kOf.get(lv.id) ?? 1,
    area: rooms.filter((l) => l.levelId === lv.id).reduce((s, l) => s + (Number(l.areaM2) || 0), 0),
    rooms: rooms.filter((l) => l.levelId === lv.id).length,
  }));
  return { lahan, gross, effective, floors, perLevel, roomCount: rooms.length };
}

/** Teks otomatis panel: [utama, data]. */
export function defaultPanelTexts(key: PanelKey, sk: PanelSourceSketch, extras: PanelCatalogExtras = {}): PanelText[] {
  const s = panelProjectSummary(sk);
  const name = sk.title?.trim() || "Proyek";
  const loc = sk.geo ? (sk.geo.label?.trim() || `${sk.geo.lat.toFixed(5)}, ${sk.geo.lon.toFixed(5)}`) : "lokasi belum dikunci";
  const kdb = s.lahan > 0 && Number.isFinite(sk.kdbPct) ? `KDB ${fmt(sk.kdbPct ?? 0)}%` : "";
  const klb = Number.isFinite(sk.klbCoef) ? `KLB ${fmt(sk.klbCoef ?? 0, 1)}` : "";
  const cuts = panelCutLabels(sk);
  const narasi = (extras.narasi ?? []).map((n) => n.text.trim()).filter(Boolean).join("\n\n");
  switch (key) {
    case "konsep":
      return [
        { title: "Konsep & Konteks", body: narasi || `${name}${sk.fungsi ? ` (${sk.fungsi})` : ""} berada di ${loc}. Analisis konteks lokasi, kawasan, jarak site terhadap fasilitas sekitar, kondisi site, serta simulasi kedekatan ruang menjadi dasar penataan massa dan zonasi fungsi.` },
        { title: "Data Tapak", body: [`Lokasi: ${loc}`, s.lahan > 0 ? `Luas lahan: ${fmt(s.lahan, 1)} m²` : "", [kdb, klb].filter(Boolean).join(" · ")].filter(Boolean).join("\n") },
      ];
    case "denah":
      return [
        { title: "Denah", body: `Organisasi ruang ${s.floors} lantai dengan ${s.roomCount} ruang. Lantai tipikal ditampilkan sekali dengan jumlah pengulangannya.` },
        { title: "Luas per Lantai", body: s.perLevel.map((lv) => `${lv.name}${lv.k > 1 ? ` (×${lv.k})` : ""}: ${fmt(lv.area, 1)} m²`).join("\n") || "Belum ada ruang." },
      ];
    case "tampak":
      return [
        { title: "Tampak", body: `Tampak empat sisi diproyeksikan langsung dari model 3D ${name}: dinding sesuai ketebalan, bukaan pintu dan jendela, serta ketinggian tiap lantai.` },
        { title: "Data Bangunan", body: `Jumlah lantai: ${s.floors}\nLuas kotor: ${fmt(s.gross, 1)} m²` },
      ];
    case "potongan":
      return [
        { title: "Potongan", body: cuts.length ? `Potongan ${cuts.join(", ")} memperlihatkan hubungan vertikal antar-lantai, struktur balok-plat, serta pembagian fungsi ruang pada setiap irisan.` : "Belum ada garis potong. Tarik garis potong di Sketsa untuk mengisi panel ini." },
        { title: "Garis Potong", body: cuts.length ? cuts.map((c) => `${c}: potongan 3D, 2D dan fungsi`).join("\n") : "—" },
      ];
    case "simulasi":
      return [
        { title: "Simulasi Lingkungan", body: `Simulasi bukaan, bayangan, lintasan matahari, iklim thermal dan aliran angin di ${loc} menguji respons fasad dan orientasi massa. Diagram eksplode dan diagram fungsi menjelaskan susunan program ruang.` },
        { title: "Catatan", body: `Orientasi utara: ${fmt(sk.northRotation ?? 0)}°` },
      ];
    case "perhitungan":
      return [
        { title: "Perhitungan & Material", body: `Total luas lantai ${fmt(s.gross, 1)} m² dengan luas efektif ${fmt(s.effective, 1)} m². Tabulasi, komposisi ruang, estimasi biaya, dan spesifikasi material diambil langsung dari data proyek.` },
        { title: "Ringkasan", body: [s.lahan > 0 ? `Luas lahan: ${fmt(s.lahan, 1)} m²` : "", `Luas kotor: ${fmt(s.gross, 1)} m²`, `Luas efektif: ${fmt(s.effective, 1)} m²`, [kdb, klb].filter(Boolean).join(" · ")].filter(Boolean).join("\n") },
      ];
    case "perspektif": {
      const titles = (extras.perspektif ?? []).map((p, i) => p.title.trim() || `Perspektif ${i + 1}`);
      return [
        { title: "Perspektif Eksterior & Interior", body: titles.length ? `Suasana ruang luar dan dalam ${name} yang merangkum material, cahaya, dan aktivitas pengguna.` : "Belum ada gambar render. Tambahkan gambar di halaman Narasi, tab Perspektif." },
        { title: "Daftar Gambar", body: titles.join("\n") || "—" },
      ];
    }
  }
}

/** Teks untuk tiap kotak teks layout: hasil edit pengguna, atau teks otomatis. */
export function panelTexts(key: PanelKey, cfg: CompetitionPanelConfig | undefined, layout: PanelLayout, sk: PanelSourceSketch, extras: PanelCatalogExtras = {}): PanelText[] {
  const auto = defaultPanelTexts(key, sk, extras);
  const slots = layout.texts.length;
  const autoFor = (i: number): PanelText => {
    if (slots === 1) {
      const [main, data] = auto;
      return { title: main?.title ?? "", body: [main?.body, data?.body ? `${data.title}\n${data.body}` : ""].filter(Boolean).join("\n\n") };
    }
    return auto[i] ?? { title: "", body: "" };
  };
  return layout.texts.map((_, i) => cfg?.texts?.[i] ?? autoFor(i));
}

// ---------- Sugesti ----------
export type PanelSuggestion = { kind: "add" | "remove" | "layout" | "info"; token?: string; layoutId?: string; message: string };

export function panelSuggestions(key: PanelKey, items: string[], layout: PanelLayout, catalog: PanelContentItem[], sk: PanelSourceSketch): PanelSuggestion[] {
  const out: PanelSuggestion[] = [];
  const byToken = new Map(catalog.map((c) => [c.token, c]));
  const label = (t: string) => byToken.get(t)?.label ?? t;
  const defaults = defaultPanelItems(key, catalog, sk);
  const slots = layout.slots.length;
  // Konten tidak tersedia lagi di proyek.
  for (const t of items) if (!byToken.has(t)) out.push({ kind: "remove", token: t, message: `Keluarkan konten yang sudah tidak ada di proyek (${t}).` });
  // Konten dari panel lain.
  for (const t of items) {
    const c = byToken.get(t);
    if (c && c.group !== key) out.push({ kind: "remove", token: t, message: `Keluarkan "${c.label}", lebih cocok di panel ${panelDef(c.group).name}.` });
  }
  // Tidak muat di layout.
  if (items.length > slots) {
    for (const t of items.slice(slots)) out.push({ kind: "remove", token: t, message: `"${label(t)}" tidak muat di layout ${layout.name}. Keluarkan, atau pilih layout yang lebih besar.` });
    const bigger = PANEL_LAYOUTS.filter((l) => l.slots.length >= items.length).sort((a, b) => a.slots.length - b.slots.length)[0];
    if (bigger) out.push({ kind: "layout", layoutId: bigger.id, message: `Pakai layout ${bigger.name} agar ${items.length} konten muat.` });
  }
  // Isi bawaan yang belum dimasukkan.
  const free = Math.max(0, slots - items.length);
  const missing = defaults.filter((t) => !items.includes(t));
  missing.slice(0, Math.max(free, 2)).forEach((t) => out.push({ kind: "add", token: t, message: `Tambahkan "${label(t)}" ke panel ini.` }));
  // Slot kosong: tawarkan konten lain dari kelompok yang sama.
  if (free > missing.length) {
    catalog.filter((c) => c.group === key && !items.includes(c.token) && !missing.includes(c.token))
      .slice(0, free - missing.length)
      .forEach((c) => out.push({ kind: "add", token: c.token, message: `Masih ada ruang kosong, tambahkan "${c.label}".` }));
  }
  if (items.length > 0 && items.length < slots - 1) {
    const tighter = PANEL_LAYOUTS.filter((l) => l.slots.length >= items.length).sort((a, b) => a.slots.length - b.slots.length)[0];
    if (tighter && tighter.id !== layout.id) out.push({ kind: "layout", layoutId: tighter.id, message: `${slots - items.length} kotak gambar kosong. Layout ${tighter.name} lebih pas.` });
  }
  if (key === "perspektif" && !catalog.some((c) => c.group === "perspektif")) {
    out.push({ kind: "info", message: "Belum ada gambar render. Tambahkan di halaman Narasi, tab Perspektif." });
  }
  if (key === "potongan" && panelCutLabels(sk).length === 0) {
    out.push({ kind: "info", message: "Belum ada garis potong. Tarik garis potong di Sketsa." });
  }
  return out.slice(0, 8);
}

export function applyPanelSuggestion(items: string[], s: PanelSuggestion): string[] {
  if (s.kind === "add" && s.token && !items.includes(s.token)) return [...items, s.token];
  if (s.kind === "remove" && s.token) return items.filter((t) => t !== s.token);
  return items;
}

/** Panel yang dibuat sebagai slide/halaman, sesuai urutan baku. */
export function activePanelKeys(settings: CompetitionPanelSettings | undefined): PanelKey[] {
  if (!settings?.enabled) return [];
  return PANEL_KEYS.filter((k) => panelIncluded(settings.panels[k]));
}

// ---------- Gaya halaman (dipakai bersama slide dan PSD) ----------
export const PANEL_COLORS = { ink: "#1d1d1b", accent: "#e85d3a", muted: "#6b6660", textBg: "#f5f2ec", border: "#d8d4cc", page: "#ffffff" };
/** Ukuran tipografi dalam unit halaman (1/1000 sisi pendek). */
export const PANEL_TYPE = { kicker: 12, title: 40, project: 17, caption: 10, captionH: 20, textTitle: 16, bodyMax: 13, bodyMin: 6, pad: 12, accent: 4, footer: 10, lineHeight: 1.4 };

/** Ukuran huruf terbesar (≤ max) agar teks muat di kotak w × h. */
export function fitPanelFontSize(text: string, w: number, h: number, max: number, min: number, lineHeight = PANEL_TYPE.lineHeight, charW = 0.54): number {
  let fs = max;
  while (fs > min) {
    const perLine = Math.max(1, Math.floor(w / (fs * charW)));
    const lines = text.split("\n").reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
    if (lines * fs * lineHeight <= h) return fs;
    fs *= 0.92;
  }
  return min;
}

// ---------- Susunan konten (bukan salinan slide) ----------
/** Rasio lebar/tinggi alami gambar tiap konten, agar ditempatkan di kotak yang sebentuk. */
const BASE_ASPECT: Record<string, number> = {
  site: 1.45, "analisis-kawasan": 1.45, masterplan: 1.4, siteplan: 1.4, "analisis-site": 1.45,
  bubble: 1.35, "bubble-total": 1.5, konsep: 1.2, "detail-axo": 1.15,
  section3d: 1.55, section: 1.9, "function-section": 1.9,
  "facade-zoning": 1.7, "shadow-seasonal": 1.7, matahari: 1.3, thermal: 1.4, wind: 1.4, "explode-axo": 0.85, stacking: 1.2,
  rekap: 1.35, volumetrik: 1.7, rincian: 1.5, komposisi: 1.35, infografis: 1.4, biaya: 1.4, "spec-outline": 1.5, furniture: 1.4,
  perspektif: 1.6, moodboard: 1.4,
};
const clampAspect = (a: number) => (Number.isFinite(a) && a > 0 ? Math.max(0.45, Math.min(3.2, a)) : 1.4);

function sketchFootprint(sk: PanelSourceSketch, rotationDeg = 0) {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of sk.layers ?? []) {
    if (l.hidden || l.isReferenceRoom || isSite(l.name)) continue;
    for (const p of l.points ?? []) {
      const x = p.x * c - p.y * s, y = p.x * s + p.y * c;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) && maxX > minX && maxY > minY ? { w: maxX - minX, h: maxY - minY } : null;
}

export function panelContentAspect(token: string, sk: PanelSourceSketch): number {
  const sep = token.indexOf(":");
  const kind = sep >= 0 ? token.slice(0, sep) : token;
  const arg = sep >= 0 ? token.slice(sep + 1) : "";
  if (kind === "lvl") {
    // Slide denah memakai bingkai bersama semua lantai (termasuk lahan).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of sk.layers ?? []) for (const p of l.points ?? []) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    // Denah + legenda ruang di sampingnya.
    return Number.isFinite(minX) && maxX > minX && maxY > minY ? clampAspect(((maxX - minX) / (maxY - minY)) * 1.15) : 1.4;
  }
  if (kind === "tampak") {
    const fp = sketchFootprint(sk, Number(sk.northRotation) || 0);
    const floors = sortedPanelLevels(sk).reduce((n, lv) => n + Math.max(1, Math.round(Number(lv.typicalCount) || 1)), 0) || 1;
    if (!fp) return 2;
    const mPerPx = sketchMetersPerPx(sk.scale);
    const width = (arg === "timur" || arg === "barat" ? fp.h : fp.w) * mPerPx;
    return clampAspect((width * 1.12) / (floors * 4 * 1.2));
  }
  return BASE_ASPECT[kind] ?? 1.4;
}

function sketchMetersPerPx(scale: string | undefined): number {
  const major: Record<string, number> = { "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10, "1:1200": 12, "1:1500": 15, "1:2000": 20 };
  return (major[scale ?? ""] ?? 1) / 80;
}

/** Bidang gambar kotak (tanpa baris keterangan). */
export function panelSlotImageBoxes(geo: PanelPageGeometry): PanelBox[] {
  const capH = PANEL_TYPE.captionH * geo.unit;
  return geo.slots.map((b) => ({ x: b.x, y: b.y, w: b.w, h: Math.max(1, b.h - capH) }));
}

/**
 * Menempatkan konten ke kotak layout sesuai bentuk gambarnya.
 * Konten pertama (prioritas) mendapat kotak terbesar; sisanya ditukar
 * sampai rasio gambar paling cocok dengan rasio kotak dan kotak besar
 * tidak dibiarkan kosong. Hasil: indeks kotak untuk tiap konten (−1 = tidak muat).
 */
export function arrangePanelSlots(boxes: PanelBox[], aspects: number[]): number[] {
  const n = Math.min(aspects.length, boxes.length);
  const out = aspects.map(() => -1);
  if (n === 0) return out;
  const area = boxes.map((b) => b.w * b.h);
  const maxArea = Math.max(...area);
  const slotAspect = boxes.map((b) => b.w / Math.max(1e-6, b.h));
  const fitCost = (item: number, slot: number) => Math.abs(Math.log(clampAspect(aspects[item]!) / slotAspect[slot]!));
  // Konten lebih awal sedikit lebih disukai di kotak lebih besar/awal agar urutan tetap terbaca.
  const orderCost = (item: number, slot: number) => 0.002 * Math.abs(item - slot) + (item === 0 ? 0 : 0.03 * (item / n) * (area[slot]! / maxArea));
  const emptyCost = (slot: number) => 0.6 * (area[slot]! / maxArea);
  const biggest = area.reduce((best, a, i) => (a > area[best]! + 1e-6 || (Math.abs(a - area[best]!) <= 1e-6 && fitCost(0, i) < fitCost(0, best) - 1e-9) ? i : best), 0);
  const slotOf = Array.from({ length: n }, () => -1);
  slotOf[0] = biggest;
  const used = new Set([biggest]);
  for (let i = 1; i < n; i++) {
    let best = -1, bestCost = Infinity;
    for (let s = 0; s < boxes.length; s++) {
      if (used.has(s)) continue;
      const c = fitCost(i, s) + orderCost(i, s) - emptyCost(s);
      if (c < bestCost - 1e-9) { bestCost = c; best = s; }
    }
    slotOf[i] = best;
    used.add(best);
  }
  const total = () => {
    const taken = new Set(slotOf);
    let c = 0;
    slotOf.forEach((s, i) => { c += fitCost(i, s) + orderCost(i, s); });
    for (let s = 0; s < boxes.length; s++) if (!taken.has(s)) c += emptyCost(s);
    return c;
  };
  let current = total();
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    for (let i = 1; i < n; i++) {
      // tukar dengan konten lain
      for (let j = i + 1; j < n; j++) {
        [slotOf[i], slotOf[j]] = [slotOf[j]!, slotOf[i]!];
        const c = total();
        if (c < current - 1e-9) { current = c; improved = true; } else [slotOf[i], slotOf[j]] = [slotOf[j]!, slotOf[i]!];
      }
      // pindah ke kotak kosong
      const taken = new Set(slotOf);
      for (let s = 0; s < boxes.length; s++) {
        if (taken.has(s)) continue;
        const prev = slotOf[i]!;
        slotOf[i] = s;
        const c = total();
        if (c < current - 1e-9) { current = c; improved = true; taken.delete(prev); taken.add(s); } else slotOf[i] = prev;
      }
    }
    if (!improved) break;
  }
  slotOf.forEach((s, i) => { out[i] = s; });
  return out;
}

/** Ukuran kanvas gambar untuk satu kotak: rasio sama dengan kotak, luas tetap,
 *  sehingga konten disusun ulang mengikuti bentuk kotak (bukan slide A3 diperkecil). */
export function panelCellFrame(aspect: number, area = 860_000) {
  const a = Math.max(0.3, Math.min(4, aspect));
  const w = Math.round(Math.sqrt(area * a));
  return { w, h: Math.round(w / a) };
}

export type PanelPlacement = { token: string; slot: number; frame: { w: number; h: number } };

/** Layout, konten terpasang, dan kotaknya — dipakai bersama alat, slide dan PSD. */
export function panelArrangement(key: PanelKey, cfg: CompetitionPanelConfig | undefined, catalog: PanelContentItem[], sk: PanelSourceSketch, orientation: PanelOrientation) {
  const items = panelItems(key, cfg, catalog, sk);
  const layout = panelLayoutFor(key, cfg, items.length);
  const page = orientation === "portrait" ? { w: 1000, h: 1414 } : { w: 1414, h: 1000 };
  const boxes = panelSlotImageBoxes(panelPageGeometry(layout, page.w, page.h));
  const slots = arrangePanelSlots(boxes, items.map((t) => panelContentAspect(t, sk)));
  const placements: PanelPlacement[] = [];
  items.forEach((token, i) => {
    const slot = slots[i]!;
    if (slot < 0) return;
    const b = boxes[slot]!;
    placements.push({ token, slot, frame: panelCellFrame(b.w / b.h) });
  });
  return { items, layout, placements };
}
