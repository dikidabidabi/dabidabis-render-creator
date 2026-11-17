/**
 * Konten RKS berformat (paragraf, penomoran 3 level, sub-poin, tabel) disimpan
 * sebagai dokumen JSON penyunting. Modul ini murni (tanpa DOM) agar dapat dipakai
 * penyunting, ekspor Word, dan tes.
 */
export type RksMark = { type: string; attrs?: Record<string, unknown> };
export type RksNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RksNode[];
  text?: string;
  marks?: RksMark[];
};
export type RksDoc = RksNode & { type: "doc" };

/** Butir pasal tetap di dokumen: 1 Lingkup, 2 Produk/Merek, 3 Deskripsi. Narasi bernomor mulai butir 4. */
export const RKS_FIXED_ITEMS = 3;
/** Lebar teks A4 tegak dengan margin 72 pt. */
const TEXT_WIDTH_PT = 451;

const ALLOWED = new Set(["doc", "paragraph", "text", "hardBreak", "orderedList", "bulletList", "listItem", "table", "tableRow", "tableCell", "tableHeader"]);

export function normalizeRksDoc(value: unknown): RksDoc | null {
  if (!value || typeof value !== "object") return null;
  const clean = (node: unknown): RksNode | null => {
    if (!node || typeof node !== "object") return null;
    const source = node as Record<string, unknown>;
    if (typeof source.type !== "string" || !ALLOWED.has(source.type)) return null;
    const out: RksNode = { type: source.type };
    if (source.type === "text") {
      if (typeof source.text !== "string" || !source.text) return null;
      out.text = source.text;
      if (Array.isArray(source.marks)) {
        const marks = source.marks.filter((mark): mark is RksMark => Boolean(mark) && typeof (mark as RksMark).type === "string").map((mark) => ({ type: mark.type }));
        if (marks.length) out.marks = marks;
      }
      return out;
    }
    if (source.attrs && typeof source.attrs === "object") {
      const attrs = source.attrs as Record<string, unknown>;
      const kept: Record<string, unknown> = {};
      for (const key of ["colspan", "rowspan", "start"]) if (typeof attrs[key] === "number") kept[key] = attrs[key];
      if (Object.keys(kept).length) out.attrs = kept;
    }
    if (Array.isArray(source.content)) out.content = source.content.map(clean).filter((child): child is RksNode => child !== null);
    return out;
  };
  const doc = clean(value);
  return doc && doc.type === "doc" ? (doc as RksDoc) : null;
}

/** Teks polos lama: setiap baris menjadi paragraf. */
export function rksDocFromText(text: string): RksDoc {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    type: "doc",
    content: lines.length ? lines.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })) : [{ type: "paragraph" }],
  };
}

export function rksPlainText(doc: RksNode | null | undefined): string {
  if (!doc) return "";
  const blocks: string[] = [];
  const walk = (node: RksNode): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    const inner = (node.content ?? []).map(walk);
    if (node.type === "paragraph") return inner.join("");
    if (node.type === "tableRow") return inner.join("\t");
    return inner.filter(Boolean).join("\n");
  };
  for (const child of doc.content ?? []) {
    const text = walk(child).trim();
    if (text) blocks.push(text);
  }
  return blocks.join("\n");
}

export function rksWordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Dokumen efektif untuk sumber RKS: dokumen berformat, atau teks lama. */
export function rksDocOf(source: { rks: string; rksDoc?: RksDoc | null }): RksDoc | null {
  if (source.rksDoc) return source.rksDoc;
  return source.rks.trim() ? rksDocFromText(source.rks) : null;
}

export function rksHasContent(doc: RksNode | null | undefined): boolean {
  return rksPlainText(doc).length > 0;
}

function esc(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(nodes: RksNode[] | undefined): string {
  return (nodes ?? []).map((node) => {
    if (node.type === "hardBreak") return "<br>";
    if (node.type !== "text") return "";
    let html = esc(node.text ?? "");
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") html = `<b>${html}</b>`;
      else if (mark.type === "italic") html = `<i>${html}</i>`;
      else if (mark.type === "underline") html = `<u>${html}</u>`;
    }
    return html;
  }).join("");
}

export function rksLetter(n: number): string {
  let value = Math.max(1, n);
  let out = "";
  while (value > 0) {
    value -= 1;
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

/** Lebar gantung label per kedalaman penomoran (pt). */
export const RKS_NUMBER_HANG_PT = [36, 44, 52] as const;
const LETTER_HANG_PT = 18;
const DASH_HANG_PT = 14;
const TAB = `<span style='mso-tab-count:1'>&nbsp;&nbsp;</span>`;

type Ctx = {
  indent: number;
  olDepth: number;
  ulDepth: number;
  prefix: string;
  counter: { n: number };
  cell: boolean;
};

/**
 * Label penomoran paragraf. Level 1–3 memakai nomor pasal sebagai awalan
 * (contoh Pasal 5: 5.4., 5.4.1., 5.4.1.1.); lebih dalam memakai huruf a), b).
 */
export function rksNumberLabel(prefix: string, depth: number, n: number): string {
  return depth <= 3 ? `${prefix}.${n}.` : `${rksLetter(n)})`;
}

/**
 * Narasi RKS sebagai HTML Word. Paragraf utama diratakan dengan teks butir level 1,
 * butir bernomor memakai indentasi gantung, sub-poin a., b. bergeser di bawah butirnya,
 * dan tabel mengikuti indentasi poin tempatnya berada.
 */
export function rksNarrativeHtml(doc: RksNode | null | undefined, pasalNumber: number, startAt = RKS_FIXED_ITEMS + 1): string {
  if (!doc) return "";
  const root: Ctx = { indent: RKS_NUMBER_HANG_PT[0], olDepth: 0, ulDepth: 0, prefix: String(pasalNumber), counter: { n: startAt - 1 }, cell: false };
  // Butir level 1 bernomor berada di tepi kiri, paragraf biasa sejajar teksnya.
  return blocks(doc.content, root);
}

/**
 * Nama kelas paragraf berindentasi. Indentasi gantung ditulis lewat kelas CSS (bukan
 * atribut style) agar Word maupun LibreOffice menempatkan label di kiri teksnya.
 * H = butir dengan label gantung, I = paragraf rata indentasi, C = paragraf dalam sel tabel.
 */
export function rksIndentClass(kind: "H" | "I" | "C" | "T", indentPt: number, hangPt = 0): string {
  return `MsoRks${kind}${Math.max(0, Math.round(indentPt))}_${Math.max(0, Math.round(hangPt))}`;
}

/** CSS untuk setiap kelas indentasi RKS yang dipakai di HTML. */
export function rksIndentCss(html: string, textCss: string): string {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const match of html.matchAll(/class=(MsoRks([HICT])(\d+)_(\d+))/g)) {
    const [, name, kind, indentText, hangText] = match;
    if (seen.has(name)) continue;
    seen.add(name);
    const indent = Number(indentText);
    const hang = Number(hangText);
    if (kind === "T") {
      rules.push(`table.${name} { margin-left:${indent}.0pt; border-collapse:collapse; mso-table-lspace:0pt; }`);
      continue;
    }
    const spacing = kind === "C" ? "margin-bottom:0cm; line-height:normal;" : "margin-bottom:6.0pt; line-height:115%; text-align:justify;";
    rules.push(`p.${name} { margin:0cm; margin-left:${indent + hang}.0pt; text-indent:${hang ? `-${hang}.0pt` : "0cm"}; ${spacing} ${textCss} }`);
  }
  return rules.join("\n");
}

function paragraphHtml(node: RksNode, ctx: Ctx, label?: { text: string; hang: number; indent: number }): string {
  const body = inline(node.content);
  if (!label && !body.trim()) return "";
  const kind = ctx.cell ? "C" : label ? "H" : "I";
  const className = label ? rksIndentClass(kind, label.indent, label.hang) : rksIndentClass(kind, ctx.indent);
  return `<p class=${className}>${label ? `${esc(label.text)}${TAB}` : ""}${body}</p>`;
}

function blocks(nodes: RksNode[] | undefined, ctx: Ctx): string {
  return (nodes ?? []).map((node) => block(node, ctx)).join("");
}

function block(node: RksNode, ctx: Ctx): string {
  if (node.type === "paragraph") return paragraphHtml(node, ctx);
  if (node.type === "orderedList" || node.type === "bulletList") return list(node, ctx);
  if (node.type === "table") return table(node, ctx);
  return "";
}

function list(node: RksNode, ctx: Ctx): string {
  const ordered = node.type === "orderedList";
  const depth = ordered ? ctx.olDepth + 1 : ctx.olDepth;
  const ulDepth = ordered ? ctx.ulDepth : ctx.ulDepth + 1;
  // Butir level 1 bernomor dimulai di tepi kiri isi pasal; butir lain di bawah teks induknya.
  const labelIndent = ordered && depth === 1 && !ctx.cell ? ctx.indent - RKS_NUMBER_HANG_PT[0] : ctx.indent;
  const hang = ordered ? (RKS_NUMBER_HANG_PT[Math.min(depth, 3) - 1] ?? 18) : ulDepth === 1 ? LETTER_HANG_PT : DASH_HANG_PT;
  const effectiveHang = ordered && depth > 3 ? LETTER_HANG_PT : hang;
  let local = 0;
  return (node.content ?? []).filter((item) => item.type === "listItem").map((item) => {
    let label: string;
    let childPrefix = ctx.prefix;
    if (ordered) {
      ctx.counter.n += 1;
      label = rksNumberLabel(ctx.prefix, depth, ctx.counter.n);
      if (depth <= 3) childPrefix = `${ctx.prefix}.${ctx.counter.n}`;
    } else {
      local += 1;
      label = ulDepth === 1 ? `${rksLetter(local)}.` : "-";
    }
    const child: Ctx = { indent: Math.max(0, labelIndent) + effectiveHang, olDepth: depth, ulDepth, prefix: childPrefix, counter: { n: 0 }, cell: ctx.cell };
    const [first, ...rest] = item.content ?? [];
    const head = first?.type === "paragraph"
      ? paragraphHtml(first, ctx, { text: label, hang: effectiveHang, indent: Math.max(0, labelIndent) })
      : paragraphHtml({ type: "paragraph" }, ctx, { text: label, hang: effectiveHang, indent: Math.max(0, labelIndent) }) + (first ? block(first, child) : "");
    return head + blocks(rest, child);
  }).join("");
}

function table(node: RksNode, ctx: Ctx): string {
  const rows = (node.content ?? []).filter((row) => row.type === "tableRow");
  if (!rows.length) return "";
  const indent = ctx.cell ? 0 : ctx.indent;
  const width = Math.max(120, TEXT_WIDTH_PT - indent);
  const body = rows.map((row) => `<tr style='page-break-inside:avoid'>${(row.content ?? []).map((cell) => {
    const header = cell.type === "tableHeader";
    const colspan = typeof cell.attrs?.colspan === "number" && cell.attrs.colspan > 1 ? ` colspan=${cell.attrs.colspan}` : "";
    const rowspan = typeof cell.attrs?.rowspan === "number" && cell.attrs.rowspan > 1 ? ` rowspan=${cell.attrs.rowspan}` : "";
    const inner = blocks(cell.content, { indent: 0, olDepth: ctx.olDepth, ulDepth: ctx.ulDepth, prefix: ctx.prefix, counter: { n: 0 }, cell: true }) || `<p class=${rksIndentClass("C", 0)}>&nbsp;</p>`;
    const tag = header ? "th" : "td";
    return `<${tag}${colspan}${rowspan} valign=top style='border:solid #999999 1.0pt;padding:3.0pt 4.0pt 3.0pt 4.0pt;vertical-align:top${header ? ";background:#F2F2F2" : ""}'>${header ? inner.replace(/<p class=(MsoRksC[\d_]+)>/g, "<p class=$1><b>").replace(/<\/p>/g, "</b></p>") : inner}</${tag}>`;
  }).join("")}</tr>`).join("");
  return `<table class=${rksIndentClass("T", indent)} border=1 cellspacing=0 cellpadding=0 width=${Math.round(width / 0.75)} style='width:${width}pt;margin-left:${indent}pt;border-collapse:collapse'>${body}</table><p class=MsoNormal style='margin:0cm;font-size:4.0pt;line-height:normal'>&nbsp;</p>`;
}

/** Apakah narasi memakai butir bernomor level 1 (menggantikan judul bawaan butir 4). */
export function rksHasNumberedItems(doc: RksNode | null | undefined): boolean {
  const walk = (nodes: RksNode[] | undefined): boolean => (nodes ?? []).some((node) => node.type === "orderedList" || (node.type !== "table" && walk(node.content)));
  return walk(doc?.content);
}
