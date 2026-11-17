import { materialCodes, type LibraryMaterial, type MaterialKind, type RksPasalDef } from "@/lib/material-library";
import { rksDocOf, rksHasContent, rksHasNumberedItems, rksNarrativeHtml, RKS_FIXED_ITEMS, type RksDoc } from "@/lib/rks-content";
import { collectSpecMaterialRefs, formatSpecNumber, specLocations, specLocationText, specMaterialArea, type SpecLocation, type SpecMaterialRef, type SpecSketch } from "@/lib/spec-outline";

/** Word-compatible RKS export: MHTML (.doc) so embedded images open in Microsoft Word. */
export const RKS_FONT_FAMILY = "Times New Roman";
export const RKS_FONT_SIZE_PT = 11;

export type RksAsset = { mime: string; base64: string; width: number; height: number };
export type RksMaterialImages = { thumb?: RksAsset; preview?: RksAsset };
export type RksInput = {
  projectTitle: string;
  dateLabel: string;
  overview: Array<{ label: string; value: string }>;
  levels: Array<{ name: string; elevation: string; typical: string; area: string }>;
  sketch: SpecSketch;
  materials: LibraryMaterial[];
  /** Pasal RKS akun; material dengan pasal sama digabung dalam satu pasal. */
  pasals?: RksPasalDef[];
  materialImages?: Map<string, RksMaterialImages>;
  /** Keyed by rksCodeKey(kind, code). */
  codeImages?: Map<string, RksAsset>;
};
export type RksOutlineRow = {
  ref: SpecMaterialRef;
  material?: LibraryMaterial;
  code: string;
  locations: SpecLocation[];
  areaM2: number | null;
};
export type RksPasalItem = RksOutlineRow & { material: LibraryMaterial };
export type RksPasal = {
  number: number;
  anchor: string;
  title: string;
  name: string;
  /** Jenis pekerjaan kemunculan pertama, menentukan kelompok pasal. */
  kind: MaterialKind;
  items: RksPasalItem[];
  pasalId: string | null;
  doc: RksDoc | null;
};

export const RKS_KIND_LABELS: Record<MaterialKind, string> = {
  "pekerjaan dasar": "Pekerjaan Dasar",
  lantai: "Pekerjaan Lantai",
  dinding: "Pekerjaan Dinding",
  plafon: "Pekerjaan Plafon",
  fasad: "Pekerjaan Fasad",
};

export function rksCodeKey(kind: MaterialKind, code: string) {
  return `${kind}:${code}`;
}

/** Same rows, order and codes as the Outline Spesifikasi slide. */
export function rksOutlineRows(sketch: SpecSketch, materials: LibraryMaterial[]): RksOutlineRow[] {
  const byId = new Map(materials.map((material) => [material.id, material]));
  const codes = materialCodes(materials);
  return collectSpecMaterialRefs(sketch).map((ref) => ({
    ref,
    material: byId.get(ref.materialId),
    code: codes.get(ref.materialId) ?? "—",
    locations: specLocations(sketch, ref),
    areaM2: specMaterialArea(sketch, ref),
  }));
}

/**
 * Pasal dalam urutan Outline Spesifikasi. Material dengan pasal RKS yang sama
 * digabung dalam satu pasal (narasi ditulis sekali); material tanpa pasal menjadi pasal sendiri.
 */
export function rksPasalList(sketch: SpecSketch, materials: LibraryMaterial[], pasals: RksPasalDef[] = []): RksPasal[] {
  const defs = new Map(pasals.map((pasal) => [pasal.id, pasal]));
  const groups = new Map<string, { def: RksPasalDef | null; items: RksPasalItem[] }>();
  for (const row of rksOutlineRows(sketch, materials)) {
    if (!row.material) continue;
    const def = row.material.pasalId ? defs.get(row.material.pasalId) ?? null : null;
    const key = def ? `pasal:${def.id}` : `material:${row.material.id}`;
    const group = groups.get(key) ?? { def, items: [] };
    group.items.push(row as RksPasalItem);
    groups.set(key, group);
  }
  return [...groups.values()].map((group, index) => {
    const number = index + 1;
    const first = group.items[0];
    const name = group.def ? group.def.name.trim() || "Pasal tanpa nama" : first.material.name.trim() || "Material tanpa nama";
    return {
      number,
      anchor: `_TocRksPasal${String(number).padStart(3, "0")}`,
      title: `Pasal ${number} — ${name}`,
      name,
      kind: first.ref.kind,
      items: group.items,
      pasalId: group.def?.id ?? null,
      doc: group.def ? rksDocOf(group.def) : rksDocOf(first.material),
    };
  });
}

function esc(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function multiline(value: string): string {
  return esc(value).replace(/\r?\n/g, "<br>");
}

const PAGE_BREAK = `<p class=MsoNormal><br clear=all style='mso-special-character:line-break;page-break-before:always'></p>`;
const SECTION_BREAK = `<span style='font-size:${RKS_FONT_SIZE_PT}.0pt;font-family:"${RKS_FONT_FAMILY}",serif'><br clear=all style='page-break-before:always;mso-break-type:section-break'></span>`;

type Toc = { level: 1 | 2 | 3; anchor: string; label: string };
type ImagePart = { name: string; asset: RksAsset };

export function buildRksHtml(input: RksInput, imageDir = "rks_files"): { html: string; images: ImagePart[] } {
  const images: ImagePart[] = [];
  const imageTag = (asset: RksAsset | undefined, alt: string) => {
    if (!asset) return "";
    const ext = asset.mime === "image/png" ? "png" : "jpg";
    const name = `image${String(images.length + 1).padStart(3, "0")}.${ext}`;
    images.push({ name, asset });
    return `<img width=${Math.round(asset.width)} height=${Math.round(asset.height)} src="${imageDir}/${name}" alt="${esc(alt)}">`;
  };
  const rows = rksOutlineRows(input.sketch, input.materials);
  const pasals = rksPasalList(input.sketch, input.materials, input.pasals ?? []);
  const toc: Toc[] = [];
  const heading = (level: 1 | 2 | 3, anchor: string, label: string, extra = "") => {
    toc.push({ level, anchor, label });
    return `<h${level}${extra}><a name="${anchor}"></a>${esc(label)}</h${level}>`;
  };

  // BAB I — Gambaran umum
  const babI: string[] = [];
  babI.push(heading(1, "_TocRksBab1", "BAB I  GAMBARAN UMUM PROYEK", " style='page-break-before:always'"));
  babI.push(`<p class=MsoBody>Dokumen Rencana Kerja dan Syarat-syarat (RKS) ini disusun untuk proyek <b>${esc(input.projectTitle)}</b>. RKS mengatur ketentuan teknis material dan pelaksanaan pekerjaan berdasarkan Outline Spesifikasi proyek, yang disusun berurutan mulai dari pekerjaan dasar, lantai, dinding, plafon, hingga fasad.</p>`);
  babI.push(heading(2, "_TocRksBab1Data", "1.1  Data Proyek"));
  babI.push(`<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 width="100%" style='width:100%;border-collapse:collapse'>${input.overview.map((row) => `<tr><td width="40%" style='width:40%;background:#F2F2F2'><p class=MsoCell><b>${esc(row.label)}</b></p></td><td width="60%" style='width:60%'><p class=MsoCell>${esc(row.value)}</p></td></tr>`).join("")}</table>`);
  babI.push(heading(2, "_TocRksBab1Level", "1.2  Data Lantai"));
  babI.push(input.levels.length === 0
    ? `<p class=MsoBody>Belum ada lantai pada sketsa.</p>`
    : `<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 width="100%" style='width:100%;border-collapse:collapse'><thead><tr>${["No", "Lantai", "Elevasi", "Tipikal", "Luas Ruang"].map((h) => `<th style='background:#F2F2F2'><p class=MsoCell><b>${h}</b></p></th>`).join("")}</tr></thead><tbody>${input.levels.map((level, index) => `<tr><td><p class=MsoCell align=center style='text-align:center'>${index + 1}</p></td><td><p class=MsoCell>${esc(level.name)}</p></td><td><p class=MsoCell align=right style='text-align:right'>${esc(level.elevation)}</p></td><td><p class=MsoCell align=center style='text-align:center'>${esc(level.typical)}</p></td><td><p class=MsoCell align=right style='text-align:right'>${esc(level.area)}</p></td></tr>`).join("")}</tbody></table>`);
  babI.push(heading(2, "_TocRksBab1Lingkup", "1.3  Lingkup Material"));
  const pasalItems = pasals.flatMap((pasal) => pasal.items);
  const kindCounts = (Object.keys(RKS_KIND_LABELS) as MaterialKind[]).map((kind) => ({ kind, count: pasalItems.filter((item) => item.ref.kind === kind).length })).filter((item) => item.count > 0);
  babI.push(kindCounts.length === 0
    ? `<p class=MsoBody>Belum ada material yang dipilih pada Rincian per Level.</p>`
    : kindCounts.map((item, index) => `<p class=MsoList>${index + 1}.<span style='mso-tab-count:1'>&nbsp;&nbsp;</span>${RKS_KIND_LABELS[item.kind]}: ${item.count} material</p>`).join(""));

  // BAB II — Pasal per material
  const babII: string[] = [];
  babII.push(heading(1, "_TocRksBab2", "BAB II  RENCANA KERJA DAN SYARAT-SYARAT TEKNIS", " style='page-break-before:always'"));
  babII.push(`<p class=MsoBody>Setiap pasal menguraikan satu kelompok pekerjaan. Material dengan pasal RKS yang sama diuraikan bersama dalam satu pasal. Urutan pasal mengikuti Outline Spesifikasi proyek.</p>`);
  if (pasals.length === 0) babII.push(`<p class=MsoBody>Belum ada material yang dipilih pada Rincian per Level.</p>`);
  let currentKind: MaterialKind | null = null;
  let groupIndex = 0;
  for (const pasal of pasals) {
    if (pasal.kind !== currentKind) {
      currentKind = pasal.kind;
      groupIndex += 1;
      babII.push(heading(2, `_TocRksGroup${groupIndex}`, `${String.fromCharCode(64 + groupIndex)}.  ${RKS_KIND_LABELS[currentKind]}`));
    }
    babII.push(heading(3, pasal.anchor, pasal.title));
    const n = pasal.number;
    const item = (sub: number, label: string, body: string) => `<p class=MsoList><b>${n}.${sub}.<span style='mso-tab-count:1'>&nbsp;&nbsp;</span>${esc(label)}</b></p>${body}`;
    const multi = pasal.items.length > 1;
    const letter = (index: number, html: string) => `<p class=MsoRks style='margin-left:54.0pt;text-indent:-18.0pt'>${String.fromCharCode(97 + (index % 26))}.<span style='mso-tab-count:1'>&nbsp;&nbsp;</span>${html}</p>`;
    const locationLines = (entry: RksPasalItem, left: number) => entry.locations.map((location) => `<p class=MsoRks style='margin-bottom:2.0pt;margin-left:${left + 14}.0pt;text-indent:-14.0pt'>-<span style='mso-tab-count:1'>&nbsp;&nbsp;</span><b>${esc(location.level)}:</b> ${esc(specLocationText(location))}</p>`).join("");
    const areaLine = (entry: RksPasalItem, left: number) => entry.areaM2 === null ? "" : `<p class=MsoRks style='margin-left:${left}.0pt'>Total luas: <b>${formatSpecNumber(entry.areaM2, 2)} m²</b></p>`;
    const nameOf = (m: LibraryMaterial) => esc(m.name || "Material tanpa nama");
    if (!multi) {
      const entry = pasal.items[0];
      babII.push(item(1, "Lingkup Pekerjaan", `<p class=MsoIndent>${RKS_KIND_LABELS[entry.ref.kind]} menggunakan material <b>${nameOf(entry.material)}</b> dengan kode <b>${esc(entry.code)}</b> pada lokasi berikut:</p>${locationLines(entry, 36)}${areaLine(entry, 36)}`));
      const m = entry.material;
      babII.push(item(2, "Produk / Merek", `<p class=MsoIndent>${m.product.trim() ? multiline(m.product) : "—"}</p>`));
      const preview = imageTag(input.materialImages?.get(m.id)?.preview, m.name);
      babII.push(item(3, "Deskripsi Material", `<p class=MsoIndent>${m.description.trim() ? multiline(m.description) : "—"}</p>${preview ? `<p class=MsoIndent>${preview}</p><p class=MsoIndent><i>Gambar referensi ${esc(m.name)}</i></p>` : ""}`));
    } else {
      babII.push(item(1, "Lingkup Pekerjaan", `<p class=MsoIndent>Pasal ini mencakup material berikut:</p>${pasal.items.map((entry, index) => letter(index, `<b>${nameOf(entry.material)}</b> — kode <b>${esc(entry.code)}</b> (${RKS_KIND_LABELS[entry.ref.kind]}), lokasi:`) + locationLines(entry, 54) + areaLine(entry, 54)).join("")}`));
      babII.push(item(2, "Produk / Merek", pasal.items.map((entry, index) => letter(index, `<b>${nameOf(entry.material)}:</b> ${entry.material.product.trim() ? multiline(entry.material.product) : "—"}`)).join("")));
      babII.push(item(3, "Deskripsi Material", pasal.items.map((entry, index) => {
        const m = entry.material;
        const preview = imageTag(input.materialImages?.get(m.id)?.preview, m.name);
        return letter(index, `<b>${nameOf(m)}:</b> ${m.description.trim() ? multiline(m.description) : "—"}`) + (preview ? `<p class=MsoRks style='margin-left:54.0pt'>${preview}</p><p class=MsoRks style='margin-left:54.0pt'><i>Gambar referensi ${esc(m.name)}</i></p>` : "");
      }).join("")));
    }
    if (rksHasNumberedItems(pasal.doc)) {
      babII.push(rksNarrativeHtml(pasal.doc, n, RKS_FIXED_ITEMS + 1));
    } else {
      babII.push(item(RKS_FIXED_ITEMS + 1, "Persyaratan Teknis dan Pelaksanaan", rksHasContent(pasal.doc)
        ? rksNarrativeHtml(pasal.doc, n, RKS_FIXED_ITEMS + 2)
        : `<p class=MsoIndent><i>Narasi RKS belum diisi pada List Material.</i></p>`));
    }
  }

  // BAB III — Lampiran tabel Outline Spesifikasi (landscape)
  const cell = (content: string, opts: { rowspan?: number; colspan?: number; align?: "left" | "center" | "right"; bold?: boolean; header?: boolean; width?: string } = {}) => {
    const tag = opts.header ? "th" : "td";
    const style = [opts.width ? `width:${opts.width}` : "", opts.header ? "background:#1B1B1B" : "", "vertical-align:" + (opts.header ? "middle" : "top")].filter(Boolean).join(";");
    const text = opts.header ? `<span style='color:white'>${content}</span>` : content;
    return `<${tag}${opts.rowspan && opts.rowspan > 1 ? ` rowspan=${opts.rowspan}` : ""}${opts.colspan ? ` colspan=${opts.colspan}` : ""}${opts.width ? ` width="${opts.width}"` : ""} valign=${opts.header ? "middle" : "top"} style='${style}'><p class=MsoCell align=${opts.align ?? "left"} style='text-align:${opts.align ?? "left"}'>${opts.bold || opts.header ? `<b>${text}</b>` : text}</p></${tag}>`;
  };
  const outlineBody = rows.map((row) => {
    const span = Math.max(1, row.locations.length);
    const codeAsset = input.codeImages?.get(rksCodeKey(row.ref.kind, row.code));
    const codeHtml = codeAsset ? imageTag(codeAsset, row.code) : `<span style='border:solid black 1.0pt;padding:1pt 3pt'><b>${esc(row.code)}</b></span>`;
    const thumb = imageTag(input.materialImages?.get(row.ref.materialId)?.thumb, row.material?.name ?? "");
    const kindLabel = row.ref.kind.replace(/\b\w/g, (c) => c.toUpperCase());
    const firstLocation = row.locations[0];
    const first = [
      cell(esc(kindLabel), { rowspan: span, bold: true }),
      cell(esc(row.material?.name || "Material tidak ditemukan"), { rowspan: span, bold: true }),
      cell(row.material?.description ? multiline(row.material.description) : "—", { rowspan: span }),
      firstLocation ? cell(esc(firstLocation.level), { bold: true }) + cell(esc(specLocationText(firstLocation))) : cell("—", { colspan: 2 }),
      cell(row.areaM2 === null ? "—" : `${formatSpecNumber(row.areaM2, 2)}&nbsp;m²`, { rowspan: span, align: "right", bold: true }),
      cell(thumb || "—", { rowspan: span, align: "center" }),
      cell(codeHtml, { rowspan: span, align: "center" }),
      cell(row.material?.product ? multiline(row.material.product) : "—", { rowspan: span }),
    ].join("");
    const rest = row.locations.slice(1).map((location) => `<tr style='page-break-inside:avoid'>${cell(esc(location.level), { bold: true })}${cell(esc(specLocationText(location)))}</tr>`).join("");
    return `<tr style='page-break-inside:avoid'>${first}</tr>${rest}`;
  }).join("");
  const outlineTable = rows.length === 0
    ? `<p class=MsoBody>Belum ada material yang dipilih pada Rincian per Level.</p>`
    : `<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 width="100%" style='width:100%;border-collapse:collapse'><thead><tr style='mso-yfti-firstrow:yes'>${cell("Item pekerjaan", { header: true, rowspan: 2, width: "9%" })}${cell("Material", { header: true, rowspan: 2, width: "14%" })}${cell("Deskripsi", { header: true, rowspan: 2, width: "17%" })}${cell("Lokasi", { header: true, colspan: 3, align: "center" })}${cell("Gambar", { header: true, rowspan: 2, width: "10%" })}${cell("Kode", { header: true, rowspan: 2, width: "7%", align: "center" })}${cell("Produk", { header: true, rowspan: 2, width: "13%" })}</tr><tr style='mso-yfti-firstrow:yes'>${cell("Lantai", { header: true, width: "9%" })}${cell("Ruang", { header: true, width: "15%" })}${cell("Luas", { header: true, width: "6%", align: "right" })}</tr></thead><tbody>${outlineBody}</tbody></table>`;
  const babIII = [heading(1, "_TocRksBab3", "BAB III  LAMPIRAN OUTLINE SPESIFIKASI"), outlineTable];

  const tocHtml = toc.map((entry) => `<p class=MsoToc${entry.level}><span class=MsoHyperlink><a href="#${entry.anchor}">${esc(entry.label)}</a></span></p>`);
  if (tocHtml.length) {
    tocHtml[0] = tocHtml[0].replace(/^<p class=MsoToc(\d)>/, (_, level) => `<p class=MsoToc${level}><!--[if supportFields]><span style='mso-element:field-begin'></span> TOC \\o "1-3" \\h \\z \\u <span style='mso-element:field-separator'></span><![endif]-->`);
  }
  const font = `font-family:"${RKS_FONT_FAMILY}",serif;mso-ascii-font-family:"${RKS_FONT_FAMILY}";mso-hansi-font-family:"${RKS_FONT_FAMILY}";mso-bidi-font-family:"${RKS_FONT_FAMILY}"`;
  const size = `font-size:${RKS_FONT_SIZE_PT}.0pt;mso-bidi-font-size:${RKS_FONT_SIZE_PT}.0pt`;
  const css = `
@page WordSection1 { size:595.3pt 841.9pt; margin:72.0pt 72.0pt 72.0pt 72.0pt; mso-header-margin:35.4pt; mso-footer-margin:35.4pt; }
div.WordSection1 { page:WordSection1; }
@page WordSection2 { size:841.9pt 595.3pt; mso-page-orientation:landscape; margin:42.5pt 42.5pt 42.5pt 42.5pt; }
div.WordSection2 { page:WordSection2; }
body, p, td, th, li, div, span, a, b, i { ${font}; }
p.MsoNormal, p.MsoBody, p.MsoCell, p.MsoList, p.MsoSub, p.MsoIndent, p.MsoRks, li.MsoNormal, div.MsoNormal { margin:0cm; margin-bottom:6.0pt; line-height:115%; ${size}; ${font}; }
p.MsoBody { text-align:justify; }
p.MsoCell { margin:0cm; line-height:normal; }
p.MsoList { margin-left:36.0pt; text-indent:-36.0pt; margin-top:6.0pt; page-break-after:avoid; }
p.MsoIndent { margin-left:36.0pt; }
p.MsoSub { margin-left:50.0pt; text-indent:-14.0pt; margin-bottom:2.0pt; }
h1 { mso-style-link:"Heading 1"; mso-outline-level:1; margin:0cm; margin-bottom:12.0pt; ${size}; ${font}; font-weight:bold; text-align:center; }
h2 { mso-style-link:"Heading 2"; mso-outline-level:2; margin:0cm; margin-top:12.0pt; margin-bottom:6.0pt; ${size}; ${font}; font-weight:bold; }
h3 { mso-style-link:"Heading 3"; mso-outline-level:3; margin:0cm; margin-top:12.0pt; margin-bottom:6.0pt; ${size}; ${font}; font-weight:bold; page-break-after:avoid; }
p.MsoToc1 { margin:0cm; margin-top:6.0pt; margin-bottom:3.0pt; ${size}; ${font}; font-weight:bold; }
p.MsoToc2 { margin:0cm; margin-left:14.0pt; margin-bottom:2.0pt; ${size}; ${font}; }
p.MsoToc3 { margin:0cm; margin-left:28.0pt; margin-bottom:2.0pt; ${size}; ${font}; }
p.MsoTitle { margin:0cm; text-align:center; ${font}; }
a:link, span.MsoHyperlink { color:black; text-decoration:none; text-underline:none; }
table.MsoTableGrid { border-collapse:collapse; mso-table-layout-alt:fixed; }
table.MsoTableGrid td, table.MsoTableGrid th { border:solid #999999 1.0pt; padding:3.0pt 4.0pt 3.0pt 4.0pt; ${size}; ${font}; }
`;
  const cover = [
    `<p class=MsoTitle style='margin-top:150pt;${size};letter-spacing:2pt'><b>RENCANA KERJA DAN SYARAT-SYARAT</b></p>`,
    `<p class=MsoTitle style='margin-top:4pt;${size}'><b>(RKS)</b></p>`,
    `<p class=MsoTitle style='margin-top:6pt;${size}'>Spesifikasi Teknis Material</p>`,
    `<p class=MsoTitle style='margin-top:96pt;font-size:20.0pt;mso-bidi-font-size:20.0pt;line-height:120%'><b>${esc(input.projectTitle.toUpperCase())}</b></p>`,
    `<p class=MsoTitle style='margin-top:200pt;${size}'>${esc(input.dateLabel)}</p>`,
  ].join("");
  const tocPage = [
    PAGE_BREAK,
    `<p class=MsoTitle style='margin-bottom:18pt;${size}'><b>DAFTAR ISI</b></p>`,
    ...tocHtml,
    `<p class=MsoNormal><!--[if supportFields]><span style='mso-element:field-end'></span><![endif]--></p>`,
  ].join("");
  const html = `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=ProgId content=Word.Document><meta name=Generator content="Dabidabi's"><title>RKS — ${esc(input.projectTitle)}</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]--><style>${css}</style></head><body lang=ID style='tab-interval:36.0pt'><div class=WordSection1>${cover}${tocPage}${babI.join("")}${babII.join("")}</div>${SECTION_BREAK}<div class=WordSection2>${babIII.join("")}</div></body></html>`;
  return { html, images };
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function wrap76(base64: string): string {
  return base64.replace(/.{1,76}/g, "$&\r\n");
}

export function buildRksMhtml(input: RksInput): string {
  const boundary = "----=_NextPart_DabidabiRKS";
  const base = "file:///C:/RKS/";
  const { html, images } = buildRksHtml(input);
  const parts = [
    [`Content-Location: ${base}rks.htm`, "Content-Transfer-Encoding: base64", `Content-Type: text/html; charset="utf-8"`, "", wrap76(utf8ToBase64(html))].join("\r\n"),
    ...images.map(({ name, asset }) => [`Content-Location: ${base}rks_files/${name}`, "Content-Transfer-Encoding: base64", `Content-Type: ${asset.mime}`, "", wrap76(asset.base64)].join("\r\n")),
  ];
  return [
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${boundary}"; type="text/html"`,
    "",
    ...parts.map((part) => `--${boundary}\r\n${part}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
