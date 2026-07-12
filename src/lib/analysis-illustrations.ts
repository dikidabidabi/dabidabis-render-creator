// Analysis Illustrations — notasi urban framework diagram (panah, zona,
// alur, node, label) yang digambar di halaman Master Plan. Memakai model
// polyline garis/tangent yang sudah ada di src/lib/axes.ts.

import * as React from "react";
import { sampleTangent } from "@/lib/axes";

export type Vec2 = { x: number; y: number };

export type AnnotationKind =
  | "arrow"       // panah — polyline tangent + chevron head
  | "arrowDashed" // panah dashed — polyline lebar putus-putus + chevron head
  | "circleDashed"// lingkaran dashed — border putus-putus, radius dari 2 titik
  | "zone"        // area terisi (polygon tertutup) atau arsir 45°
  | "flow"        // alur / desire line — dashed + chevron head
  | "node"        // titik nodal (lingkaran putih + pola berwarna)
  | "access"      // access point (lingkaran putih + border warna)
  | "label"       // callout teks + leader line
  | "border";     // outline putus-putus (kontur area)

export type PathStyle = "garis" | "tangent";

export type Annotation = {
  id: string;
  kind: AnnotationKind;
  style: PathStyle;          // untuk kind bertype path (arrow/zone/flow/border)
  /** Titik-titik kontrol dunia (pixel). Untuk node/access/label = 1..2 titik. */
  points: Vec2[];
  color: string;             // warna utama (stroke + fill semi-transparan)
  strokeWidthPx?: number;    // default per-kind
  text?: string;             // untuk label
  fontScale?: number;        // multiplier ukuran teks label (default 1)
  hatch?: boolean;           // zona: arsir 45° tanpa border (default false)
  sizeScale?: number;        // node/access: multiplier ukuran (default 1)
  /** circleDashed: alpha isi solid di dalam lingkaran (0..1). Tidak
   *  mempengaruhi transparansi border. Default 0 (tidak ada isi). */
  fillAlpha?: number;
  createdAt: number;
};

export const ANNOTATION_PRESETS: Record<AnnotationKind, { label: string; color: string; style: PathStyle; strokeWidthPx: number; needsPath: boolean; minPts: number; hint: string }> = {
  arrow:        { label: "Panah",           color: "#0f172a", style: "tangent", strokeWidthPx: 50, needsPath: true,  minPts: 2, hint: "Panah tangent (bisa dilengkungkan). Klik titik-titik, Enter/Selesai." },
  arrowDashed:  { label: "Panah dashed",    color: "#0f172a", style: "tangent", strokeWidthPx: 50, needsPath: true,  minPts: 2, hint: "Panah putus-putus tangent (bisa dilengkungkan). Klik titik-titik, Enter/Selesai." },
  circleDashed: { label: "Lingkaran dashed", color: "#0f172a", style: "garis",   strokeWidthPx: 20, needsPath: true,  minPts: 2, hint: "Klik titik pusat, lalu klik titik pinggir (drag diagonal) untuk radius." },
  zone:   { label: "Zona",        color: "#dc2626", style: "tangent", strokeWidthPx: 1.5, needsPath: true, minPts: 3, hint: "Klik keliling area, tekan Enter/Selesai untuk menutup." },
  flow:   { label: "Alur",        color: "#16a34a", style: "tangent", strokeWidthPx: 8,  needsPath: true,  minPts: 2, hint: "Alur / desire line (dashed) + panah. Klik titik-titik, Enter/Selesai." },
  border: { label: "Border",      color: "#2563eb", style: "tangent", strokeWidthPx: 2.5, needsPath: true, minPts: 3, hint: "Kontur/pembatas dashed. Klik titik-titik, Enter/Selesai." },
  node:   { label: "Node",        color: "#f97316", style: "garis",   strokeWidthPx: 2,   needsPath: false, minPts: 1, hint: "Klik satu titik untuk meletakkan node." },
  access: { label: "Access",      color: "#ea580c", style: "garis",   strokeWidthPx: 2,   needsPath: false, minPts: 1, hint: "Klik satu titik untuk access point." },
  label:  { label: "Label",       color: "#0f172a", style: "garis",   strokeWidthPx: 1.2, needsPath: true,  minPts: 2, hint: "Klik titik jangkar, lalu klik posisi kotak label (panah bebas panjang), Enter/Selesai." },
};

export const ANNOTATION_COLOR_SWATCHES = [
  "#dc2626", "#ea580c", "#f59e0b", "#16a34a", "#0ea5e9",
  "#2563eb", "#7c3aed", "#db2777", "#64748b", "#0f172a",
];

export function newAnnotationId(): string {
  return `an_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Polyline sampled (mengikuti style). */
export function annotationPolyline(a: Annotation): Vec2[] {
  if (a.style === "tangent" && a.points.length >= 3) return sampleTangent(a.points, 18);
  return a.points.slice();
}

/** Konfigurasi "Layer Ilustrasi" — layer khusus untuk semua notasi ilustrasi
 *  analisa, dengan sub-layer per tool (kind). Bisa diatur visible & opacity. */
export type IluSubLayer = { visible: boolean; opacity: number; name?: string };
export type IluLayerCfg = {
  visible: boolean;
  opacity: number;
  subs: Partial<Record<AnnotationKind, IluSubLayer>>;
};

export function makeIluLayerCfg(): IluLayerCfg {
  return { visible: true, opacity: 1, subs: {} };
}

export function ensureIluSub(cfg: IluLayerCfg, kind: AnnotationKind): IluLayerCfg {
  if (cfg.subs[kind]) return cfg;
  return { ...cfg, subs: { ...cfg.subs, [kind]: { visible: true, opacity: 1 } } };
}

export function normalizeIluLayer(raw: unknown): IluLayerCfg | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r: any = raw;
  const cfg: IluLayerCfg = {
    visible: r.visible !== false,
    opacity: Number.isFinite(Number(r.opacity)) ? Math.max(0, Math.min(1, Number(r.opacity))) : 1,
    subs: {},
  };
  if (r.subs && typeof r.subs === "object") {
    for (const k of Object.keys(r.subs) as AnnotationKind[]) {
      if (!(k in ANNOTATION_PRESETS)) continue;
      const s: any = r.subs[k];
      if (!s || typeof s !== "object") continue;
      cfg.subs[k] = {
        visible: s.visible !== false,
        opacity: Number.isFinite(Number(s.opacity)) ? Math.max(0, Math.min(1, Number(s.opacity))) : 1,
        name: typeof s.name === "string" && s.name.trim() ? s.name : undefined,
      };
    }
  }
  return cfg;
}

/** Alpha efektif untuk sebuah annotation kind di dalam Layer Ilustrasi. */
export function iluAlphaFor(cfg: IluLayerCfg | undefined, kind: AnnotationKind): number {
  if (!cfg) return 1;
  if (!cfg.visible) return 0;
  const sub = cfg.subs[kind];
  if (sub && !sub.visible) return 0;
  const subA = sub ? sub.opacity : 1;
  return Math.max(0, Math.min(1, cfg.opacity * subA));
}

/** Nama sub-layer efektif (custom bila diisi, fallback ke label preset). */
export function iluNameFor(cfg: IluLayerCfg | undefined, kind: AnnotationKind): string {
  const custom = cfg?.subs[kind]?.name;
  if (custom && custom.trim()) return custom;
  return ANNOTATION_PRESETS[kind].label;
}


/**
 * Ordering: node & access selalu di atas ilustrasi lain.
 * Panggil sebelum me-render array anotasi.
 */
export function sortAnnotationsForRender(list: Annotation[]): Annotation[] {
  const order: Record<AnnotationKind, number> = {
    zone: 0, border: 1, flow: 2, arrow: 3, arrowDashed: 4, circleDashed: 4.5, label: 5, access: 6, node: 7,
  };
  return list.slice().sort((a, b) => (order[a.kind] ?? 0) - (order[b.kind] ?? 0));
}


/** Normalize dari data mentah localStorage. */
export function normalizeAnnotations(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return [];
  const out: Annotation[] = [];
  for (const r of raw as any[]) {
    if (!r || typeof r !== "object") continue;
    const kind: AnnotationKind = ["arrow", "arrowDashed", "circleDashed", "zone", "flow", "node", "access", "label", "border"].includes(r.kind) ? r.kind : "arrow";
    const preset = ANNOTATION_PRESETS[kind];
    const style: PathStyle = (r.style === "tangent" || r.style === "garis") ? r.style : preset.style;
    const pts: Vec2[] = [];
    if (Array.isArray(r.points)) {
      for (const p of r.points) {
        const x = Number(p?.x), y = Number(p?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
      }
    }
    // Toleransi migrasi: label lama boleh punya 1 titik (fallback offset otomatis).
    const minPtsEff = kind === "label" ? 1 : preset.minPts;
    if (pts.length < minPtsEff) continue;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : newAnnotationId(),
      kind,
      style,
      points: pts,
      color: typeof r.color === "string" ? r.color : preset.color,
      strokeWidthPx: Number.isFinite(Number(r.strokeWidthPx)) ? Number(r.strokeWidthPx) : preset.strokeWidthPx,
      text: typeof r.text === "string" ? r.text : undefined,
      fontScale: Number.isFinite(Number(r.fontScale)) ? Math.max(0.4, Math.min(5, Number(r.fontScale))) : 1,
      hatch: r.hatch === true,
      sizeScale: Number.isFinite(Number(r.sizeScale)) ? Math.max(0.3, Math.min(6, Number(r.sizeScale))) : 1,
      fillAlpha: Number.isFinite(Number(r.fillAlpha)) ? Math.max(0, Math.min(1, Number(r.fillAlpha))) : 0,
      createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : Date.now(),
    });
  }
  return out;
}

/** Konversi warna hex/rgb → rgba dengan alpha. */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4
      ? color.slice(1).split("").map((c) => c + c).join("")
      : color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

/**
 * Chevron arrowhead — dua bar 45° yang bertemu di TIP pada SUDUT LUAR
 * masing-masing (outer corner). Bar A menuju back-left, bar B menuju
 * back-right; thickness setiap bar tumbuh KE DALAM (ke arah sumbu panah),
 * sehingga tip = sudut terluar yang bersama.
 */
function drawChevronCanvas(
  ctx: CanvasRenderingContext2D,
  tip: Vec2,
  angH: number,
  color: string,
  sw: number,
): void {
  const hL = sw * 2.4;
  const barThick = Math.max(1, sw * 0.6);
  const angA = angH + (3 * Math.PI) / 4;
  const angB = angH - (3 * Math.PI) / 4;
  // Normal ke ARAH DALAM (toward axis) — kebalikan dari sebelumnya (outward).
  const inA = angH - (3 * Math.PI) / 4;
  const inB = angH + (3 * Math.PI) / 4;
  const drawBar = (dRad: number, nRad: number) => {
    const dx = Math.cos(dRad), dy = Math.sin(dRad);
    const nx = Math.cos(nRad), ny = Math.sin(nRad);
    const p1 = { x: tip.x, y: tip.y }; // outer corner @ tip
    const p2 = { x: tip.x + dx * hL, y: tip.y + dy * hL }; // outer corner @ back
    const p3 = { x: p2.x + nx * barThick, y: p2.y + ny * barThick }; // inner corner @ back
    const p4 = { x: tip.x + nx * barThick, y: tip.y + ny * barThick }; // inner corner @ tip
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = color;
  drawBar(angA, inA);
  drawBar(angB, inB);
}

function chevronSvg(
  tip: Vec2,
  angH: number,
  color: string,
  sw: number,
  keyPrefix: string,
  nodes: any[],
): void {
  const hL = sw * 2.4;
  const barThick = Math.max(1, sw * 0.6);
  const angA = angH + (3 * Math.PI) / 4;
  const angB = angH - (3 * Math.PI) / 4;
  const inA = angH - (3 * Math.PI) / 4;
  const inB = angH + (3 * Math.PI) / 4;
  const barPath = (dRad: number, nRad: number, key: string) => {
    const dx = Math.cos(dRad), dy = Math.sin(dRad);
    const nx = Math.cos(nRad), ny = Math.sin(nRad);
    const p1 = tip;
    const p2 = { x: tip.x + dx * hL, y: tip.y + dy * hL };
    const p3 = { x: p2.x + nx * barThick, y: p2.y + ny * barThick };
    const p4 = { x: tip.x + nx * barThick, y: tip.y + ny * barThick };
    const dd = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} L ${p4.x} ${p4.y} Z`;
    nodes.push(React.createElement("path", { key, d: dd, fill: color, stroke: "none" }));
  };
  barPath(angA, inA, `${keyPrefix}-h1`);
  barPath(angB, inB, `${keyPrefix}-h2`);
}

/**
 * Pangkas polyline (screen-space) dari ujung terakhir mundur sejauh
 * `inset` sepanjang arc-length. Menghapus sampel-sampel yang lebih dekat
 * dari `inset` ke tip dan menyisipkan titik potong tepat pada jarak inset.
 * Dipakai supaya ujung shaft panah dashed tidak melewati chevron di path
 * tangent yang melengkung (sampel padat bisa membuat titik sebelum tip
 * berada lebih dekat dari inset → segmen terakhir "membalik" ke belakang).
 */
function truncatePolylineAtInset(pts: Vec2[], inset: number): Vec2[] {
  if (pts.length < 2 || inset <= 0) return pts.slice();
  let remaining = inset;
  for (let i = pts.length - 1; i > 0; i--) {
    const cur = pts[i], prev = pts[i - 1];
    const seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (seg >= remaining) {
      const t = remaining / seg;
      const nx = cur.x + (prev.x - cur.x) * t;
      const ny = cur.y + (prev.y - cur.y) * t;
      return [...pts.slice(0, i), { x: nx, y: ny }];
    }
    remaining -= seg;
  }
  return [pts[0]];
}

/** Render satu anotasi ke Canvas 2D. worldToScreen di-supply oleh caller. */
export function drawAnnotationCanvas(
  ctx: CanvasRenderingContext2D,
  a: Annotation,
  worldToScreen: (p: Vec2) => Vec2,
  viewScale: number,
): void {
  const preset = ANNOTATION_PRESETS[a.kind];
  const sw = (a.strokeWidthPx ?? preset.strokeWidthPx) * Math.max(0.5, Math.min(2.5, viewScale));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (a.kind === "node" || a.kind === "access") {
    const p = worldToScreen(a.points[0]);
    const sz = a.sizeScale ?? 1;
    const rBase = a.kind === "node" ? 18 : 20;
    const r = rBase * Math.max(0.7, Math.min(1.6, viewScale)) * sz;
    // Latar putih
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    // Border warna (tebal)
    ctx.strokeStyle = a.color;
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    if (a.kind === "node") {
      // Pola berwarna di tengah (dot + asterisk)
      ctx.fillStyle = a.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(1.5, r * 0.14);
      const spikes = 6;
      for (let i = 0; i < spikes; i++) {
        const ang = (Math.PI * i) / spikes;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(ang) * r * 0.75, p.y + Math.sin(ang) * r * 0.75);
        ctx.lineTo(p.x - Math.cos(ang) * r * 0.75, p.y - Math.sin(ang) * r * 0.75);
        ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }

  if (a.kind === "label") {
    const anchor = worldToScreen(a.points[0]);
    const hasSecond = a.points.length >= 2;
    const labelPos = hasSecond ? worldToScreen(a.points[1]) : { x: anchor.x + 10, y: anchor.y };
    const fs = 12 * Math.max(0.9, Math.min(1.6, viewScale)) * (a.fontScale ?? 1);
    ctx.fillStyle = a.color;
    ctx.font = `600 ${fs}px Manrope, sans-serif`;
    ctx.textBaseline = "middle";
    const txt = a.text || "Label";
    const pad = fs * 0.5;
    const m = ctx.measureText(txt);
    const w = m.width + pad * 2;
    const h = fs * 1.6;
    ctx.strokeStyle = a.color;
    ctx.lineWidth = Math.max(1, fs * 0.08);
    ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(labelPos.x, labelPos.y); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(labelPos.x - w / 2, labelPos.y - h / 2, w, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = a.color;
    ctx.beginPath(); ctx.arc(anchor.x, anchor.y, Math.max(3, fs * 0.18), 0, Math.PI * 2); ctx.fill();
    ctx.fillText(txt, labelPos.x - w / 2 + pad, labelPos.y);
    ctx.restore();
    return;
  }

  if (a.kind === "circleDashed") {
    if (a.points.length < 2) { ctx.restore(); return; }
    const c = worldToScreen(a.points[0]);
    const e = worldToScreen(a.points[1]);
    const r = Math.max(1, Math.hypot(e.x - c.x, e.y - c.y));
    // Isi solid (opsional) — hanya di dalam area lingkaran, tidak mempengaruhi border.
    const fa = Math.max(0, Math.min(1, Number(a.fillAlpha) || 0));
    if (fa > 0) {
      ctx.fillStyle = withAlpha(a.color, fa);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Border dashed — rasio 0.5:0.3 mengikuti panah dashed
    ctx.setLineDash([sw * 0.5, sw * 0.3]);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = sw;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  // path kinds
  const poly = annotationPolyline(a);
  if (poly.length < 2) { ctx.restore(); return; }


  if (a.kind === "zone") {
    // Bangun path polygon di screen space
    ctx.beginPath();
    const s0 = worldToScreen(poly[0]); ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < poly.length; i++) { const s = worldToScreen(poly[i]); ctx.lineTo(s.x, s.y); }
    ctx.closePath();
    if (a.hatch) {
      // Arsir 45° tanpa border. Clip ke polygon, gambar garis diagonal.
      ctx.save();
      ctx.clip();
      // Cari bbox dari poly di screen
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        const s = worldToScreen(p);
        if (s.x < minX) minX = s.x; if (s.y < minY) minY = s.y;
        if (s.x > maxX) maxX = s.x; if (s.y > maxY) maxY = s.y;
      }
      const spacing = Math.max(6, sw * 4);
      ctx.strokeStyle = withAlpha(a.color, 0.75);
      ctx.lineWidth = Math.max(1, sw * 1.4);
      ctx.lineCap = "butt";
      // Garis 45°: y = x + c. c berkisar dari (minY-maxX) sampai (maxY-minX).
      const cStart = Math.floor((minY - maxX) / spacing) * spacing;
      const cEnd = maxY - minX;
      for (let c = cStart; c <= cEnd; c += spacing) {
        // Garis dari x=minX-100 → x=maxX+100
        const x1 = minX - 200;
        const x2 = maxX + 200;
        const y1 = x1 + c;
        const y2 = x2 + c;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.fillStyle = withAlpha(a.color, 0.35);
      ctx.fill();
      ctx.strokeStyle = withAlpha(a.color, 0.9);
      ctx.lineWidth = Math.max(1, sw);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (a.kind === "border") {
    const dash = [Math.max(6, sw * 4), Math.max(4, sw * 3)];
    ctx.setLineDash(dash);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = sw;
    ctx.beginPath();
    const s0 = worldToScreen(poly[0]); ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < poly.length; i++) { const s = worldToScreen(poly[i]); ctx.lineTo(s.x, s.y); }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    return;
  }

  // arrow / arrowDashed / flow — semua pakai chevron head yang sama.
  const sEndFull = worldToScreen(poly[poly.length - 1]);
  const sPrevFull = worldToScreen(poly[poly.length - 2]);
  const angH = Math.atan2(sEndFull.y - sPrevFull.y, sEndFull.x - sPrevFull.x);
  const tip = sEndFull;
  // Ujung shaft berakhir di sudut DALAM chevron (bukan di ujung terluar tip).
  // barThick = sw*0.6 → inset di sepanjang sumbu panah = barThick * √2.
  // Untuk arrowDashed, beri jarak ekstra 1× ketebalan antara ujung garis & sudut dalam chevron.
  const gap = a.kind === "arrowDashed" ? sw : 0;
  const inset = sw * 0.6 * Math.SQRT2 + gap;
  const innerTip = { x: tip.x - Math.cos(angH) * inset, y: tip.y - Math.sin(angH) * inset };

  ctx.lineCap = a.kind === "flow" ? "round" : "butt";
  ctx.lineJoin = a.kind === "flow" ? "round" : "miter";
  if (a.kind === "arrowDashed") ctx.setLineDash([sw * 0.5, sw * 0.3]);
  else if (a.kind === "flow") ctx.setLineDash([Math.max(6, sw * 1.6), Math.max(4, sw * 1.0)]);
  else ctx.setLineDash([]);
  ctx.strokeStyle = a.color;
  ctx.lineWidth = sw;
  ctx.beginPath();
  const s0 = worldToScreen(poly[0]); ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < poly.length - 1; i++) { const s = worldToScreen(poly[i]); ctx.lineTo(s.x, s.y); }
  ctx.lineTo(innerTip.x, innerTip.y);
  ctx.stroke();
  ctx.setLineDash([]);
  drawChevronCanvas(ctx, tip, angH, a.color, sw);
  ctx.restore();
}

/** Render satu anotasi ke SVG (React). worldToScreen di-supply oleh caller. */
export function annotationSvgElements(
  a: Annotation,
  worldToScreen: (p: Vec2) => Vec2,
  keyPrefix: string,
  scale = 1,
): React.ReactNode[] {
  const preset = ANNOTATION_PRESETS[a.kind];
  const sw = (a.strokeWidthPx ?? preset.strokeWidthPx) * scale;
  const nodes: any[] = [];

  if (a.kind === "node" || a.kind === "access") {
    const p = worldToScreen(a.points[0]);
    const sz = a.sizeScale ?? 1;
    const rBase = a.kind === "node" ? 18 : 20;
    const r = rBase * scale * sz;
    const border = Math.max(2, r * 0.18);
    // Latar putih + border warna
    nodes.push(React.createElement("circle", { key: `${keyPrefix}-bg`, cx: p.x, cy: p.y, r, fill: "#ffffff", stroke: a.color, strokeWidth: border }));
    if (a.kind === "node") {
      // Pola berwarna di tengah
      nodes.push(React.createElement("circle", { key: `${keyPrefix}-d`, cx: p.x, cy: p.y, r: r * 0.32, fill: a.color }));
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * i) / 6;
        nodes.push(React.createElement("line", {
          key: `${keyPrefix}-s${i}`,
          x1: p.x + Math.cos(ang) * r * 0.75, y1: p.y + Math.sin(ang) * r * 0.75,
          x2: p.x - Math.cos(ang) * r * 0.75, y2: p.y - Math.sin(ang) * r * 0.75,
          stroke: a.color, strokeWidth: Math.max(1.5, r * 0.14), strokeLinecap: "round",
        }));
      }
    }
    return nodes;
  }

  if (a.kind === "label") {
    const anchor = worldToScreen(a.points[0]);
    const labelPos = a.points.length >= 2 ? worldToScreen(a.points[1]) : { x: anchor.x + 10, y: anchor.y };
    const txt = a.text || "Label";
    const fs = 12 * scale * (a.fontScale ?? 1);
    const boxH = fs * 1.6;
    const boxW = Math.max(fs * 2.5, txt.length * fs * 0.62 + fs);
    nodes.push(React.createElement("line", { key: `${keyPrefix}-l`, x1: anchor.x, y1: anchor.y, x2: labelPos.x, y2: labelPos.y, stroke: a.color, strokeWidth: Math.max(1, fs * 0.08) }));
    nodes.push(React.createElement("circle", { key: `${keyPrefix}-a`, cx: anchor.x, cy: anchor.y, r: Math.max(3, fs * 0.18), fill: a.color }));
    nodes.push(React.createElement("rect", { key: `${keyPrefix}-b`, x: labelPos.x - boxW / 2, y: labelPos.y - boxH / 2, width: boxW, height: boxH, fill: "rgba(255,255,255,0.92)", stroke: a.color }));
    nodes.push(React.createElement("text", { key: `${keyPrefix}-t`, x: labelPos.x, y: labelPos.y + fs * 0.35, textAnchor: "middle", fill: a.color, fontSize: fs, fontWeight: 600, style: { fontFamily: "Manrope, sans-serif" } }, txt));
    return nodes;
  }

  if (a.kind === "circleDashed") {
    if (a.points.length < 2) return nodes;
    const c = worldToScreen(a.points[0]);
    const e = worldToScreen(a.points[1]);
    const r = Math.max(1, Math.hypot(e.x - c.x, e.y - c.y));
    const dash = `${sw * 0.5},${sw * 0.3}`;
    nodes.push(React.createElement("circle", {
      key: `${keyPrefix}-p`, cx: c.x, cy: c.y, r, fill: "none",
      stroke: a.color, strokeWidth: sw, strokeDasharray: dash,
    }));
    return nodes;
  }

  const poly = annotationPolyline(a);
  if (poly.length < 2) return nodes;
  const pts = poly.map(worldToScreen);
  const d = "M " + pts.map((p) => `${p.x} ${p.y}`).join(" L ");


  if (a.kind === "zone") {
    if (a.hatch) {
      // Bounding box screen
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      }
      const spacing = Math.max(6, sw * 4);
      const cStart = Math.floor((minY - maxX) / spacing) * spacing;
      const cEnd = maxY - minX;
      const clipId = `${keyPrefix}-clip`;
      const lines: any[] = [];
      let li = 0;
      for (let c = cStart; c <= cEnd; c += spacing) {
        const x1 = minX - 200;
        const x2 = maxX + 200;
        const y1 = x1 + c;
        const y2 = x2 + c;
        lines.push(React.createElement("line", {
          key: `${keyPrefix}-hl-${li++}`,
          x1, y1, x2, y2,
          stroke: a.color, strokeOpacity: 0.75, strokeWidth: Math.max(1, sw * 1.4),
        }));
      }
      nodes.push(React.createElement("defs", { key: `${keyPrefix}-defs` },
        React.createElement("clipPath", { id: clipId },
          React.createElement("path", { d: d + " Z" }),
        ),
      ));
      nodes.push(React.createElement("g", { key: `${keyPrefix}-hatch`, clipPath: `url(#${clipId})` }, lines));
    } else {
      nodes.push(React.createElement("path", { key: `${keyPrefix}-p`, d: d + " Z", fill: withAlpha(a.color, 0.32), stroke: withAlpha(a.color, 0.9), strokeWidth: sw }));
    }
    return nodes;
  }
  if (a.kind === "border") {
    const dash = `${Math.max(6, sw * 4)},${Math.max(4, sw * 3)}`;
    nodes.push(React.createElement("path", { key: `${keyPrefix}-p`, d: d + " Z", fill: "none", stroke: a.color, strokeWidth: sw, strokeDasharray: dash, strokeLinecap: "round" }));
    return nodes;
  }

  // arrow / arrowDashed / flow — dash pattern beda, chevron head sama.
  const tip = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const angH = Math.atan2(tip.y - prev.y, tip.x - prev.x);
  const gap = a.kind === "arrowDashed" ? sw : 0;
  const inset = sw * 0.6 * Math.SQRT2 + gap;
  const innerTip = { x: tip.x - Math.cos(angH) * inset, y: tip.y - Math.sin(angH) * inset };
  const shaftPts = [...pts.slice(0, -1), innerTip];
  const dShaft = "M " + shaftPts.map((p) => `${p.x} ${p.y}`).join(" L ");
  let strokeDasharray: string | undefined;
  let strokeLinecap: "butt" | "round" = "butt";
  let strokeLinejoin: "miter" | "round" = "miter";
  if (a.kind === "arrowDashed") strokeDasharray = `${sw * 0.5},${sw * 0.3}`;
  else if (a.kind === "flow") { strokeDasharray = `${Math.max(6, sw * 1.6)},${Math.max(4, sw * 1.0)}`; strokeLinecap = "round"; strokeLinejoin = "round"; }
  nodes.push(React.createElement("path", {
    key: `${keyPrefix}-p`, d: dShaft, fill: "none", stroke: a.color, strokeWidth: sw,
    strokeLinecap, strokeLinejoin, ...(strokeDasharray ? { strokeDasharray } : {}),
  }));
  chevronSvg(tip, angH, a.color, sw, keyPrefix, nodes);
  return nodes;
}
