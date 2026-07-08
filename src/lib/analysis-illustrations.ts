// Analysis Illustrations — notasi urban framework diagram (panah, zona,
// alur, node, label) yang digambar di halaman Master Plan. Memakai model
// polyline garis/tangent yang sudah ada di src/lib/axes.ts.

import * as React from "react";
import { sampleTangent } from "@/lib/axes";

export type Vec2 = { x: number; y: number };

export type AnnotationKind =
  | "arrow"       // panah — polyline dengan arrowhead
  | "arrowDashed" // panah dashed — polyline lebar putus-putus dengan arrowhead
  | "zone"        // area terisi (polygon tertutup)
  | "flow"        // alur / desire line — garis putus-putus tebal
  | "node"        // titik nodal (lingkaran + asterisk)
  | "access"      // access point (lingkaran outline)
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
  createdAt: number;
};

export const ANNOTATION_PRESETS: Record<AnnotationKind, { label: string; color: string; style: PathStyle; strokeWidthPx: number; needsPath: boolean; minPts: number; hint: string }> = {
  arrow:       { label: "Panah",        color: "#64748b", style: "garis",   strokeWidthPx: 14, needsPath: true,  minPts: 2, hint: "Klik titik-titik jalur panah, tekan Enter/Selesai." },
  arrowDashed: { label: "Panah dashed", color: "#0f172a", style: "tangent", strokeWidthPx: 50, needsPath: true, minPts: 2, hint: "Panah putus-putus tangent (bisa dilengkungkan). Klik titik-titik, Enter/Selesai." },
  zone:   { label: "Zona",        color: "#dc2626", style: "tangent", strokeWidthPx: 1.5, needsPath: true, minPts: 3, hint: "Klik keliling area, tekan Enter/Selesai untuk menutup." },
  flow:   { label: "Alur",        color: "#16a34a", style: "tangent", strokeWidthPx: 8,  needsPath: true,  minPts: 2, hint: "Alur / desire line (dashed). Klik titik-titik, Enter/Selesai." },
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
export type IluSubLayer = { visible: boolean; opacity: number };
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


/** Normalize dari data mentah localStorage. */
export function normalizeAnnotations(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return [];
  const out: Annotation[] = [];
  for (const r of raw as any[]) {
    if (!r || typeof r !== "object") continue;
    const kind: AnnotationKind = ["arrow", "arrowDashed", "zone", "flow", "node", "access", "label", "border"].includes(r.kind) ? r.kind : "arrow";
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
    const r = a.kind === "node" ? 14 * Math.max(0.7, Math.min(1.6, viewScale)) : 16 * Math.max(0.7, Math.min(1.6, viewScale));
    ctx.strokeStyle = a.color;
    ctx.lineWidth = sw;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    if (a.kind === "node") {
      // asterisk
      ctx.fillStyle = a.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = withAlpha(a.color, 0.9);
      ctx.lineWidth = sw * 0.8;
      const spikes = 6;
      for (let i = 0; i < spikes; i++) {
        const ang = (Math.PI * i) / spikes;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(ang) * r * 0.9, p.y + Math.sin(ang) * r * 0.9);
        ctx.lineTo(p.x - Math.cos(ang) * r * 0.9, p.y - Math.sin(ang) * r * 0.9);
        ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }

  if (a.kind === "label") {
    const p = worldToScreen(a.points[0]);
    ctx.fillStyle = a.color;
    ctx.font = `600 ${12 * Math.max(0.9, Math.min(1.6, viewScale))}px Manrope, sans-serif`;
    ctx.textBaseline = "middle";
    const txt = a.text || "Label";
    const pad = 6;
    const m = ctx.measureText(txt);
    const w = m.width + pad * 2;
    const h = 20 * Math.max(0.9, Math.min(1.6, viewScale));
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(p.x + 10, p.y - h / 2, w, h);
    ctx.fill(); ctx.stroke();
    // leader line
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 10, p.y); ctx.stroke();
    // dot
    ctx.fillStyle = a.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(txt, p.x + 10 + pad, p.y);
    ctx.restore();
    return;
  }

  // path kinds
  const poly = annotationPolyline(a);
  if (poly.length < 2) { ctx.restore(); return; }

  if (a.kind === "zone") {
    ctx.beginPath();
    const s0 = worldToScreen(poly[0]); ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < poly.length; i++) { const s = worldToScreen(poly[i]); ctx.lineTo(s.x, s.y); }
    ctx.closePath();
    ctx.fillStyle = withAlpha(a.color, 0.35);
    ctx.fill();
    ctx.strokeStyle = withAlpha(a.color, 0.9);
    ctx.lineWidth = Math.max(1, sw);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (a.kind === "flow" || a.kind === "border") {
    const dash = a.kind === "flow" ? [Math.max(6, sw * 1.6), Math.max(4, sw * 1.0)] : [Math.max(6, sw * 4), Math.max(4, sw * 3)];
    ctx.setLineDash(dash);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = sw;
    ctx.beginPath();
    const s0 = worldToScreen(poly[0]); ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < poly.length; i++) { const s = worldToScreen(poly[i]); ctx.lineTo(s.x, s.y); }
    if (a.kind === "border") ctx.closePath();
    ctx.stroke();
    ctx.restore();
    return;
  }

  // arrow (garis solid) atau arrowDashed (garis putus-putus lebar, siku, chevron head)
  if (a.kind === "arrowDashed") {
    // Arrowhead — dua persegi panjang yang bertemu di TIP membentuk sudut
    // siku-siku (90°). Titik pertemuan (tip) = ujung runcing menghadap arah
    // panah; masing-masing bar menjulur ke belakang pada sudut 45° dari
    // sumbu panah, sehingga sudut internal antar bar = 90°.
    const sEndFull = worldToScreen(poly[poly.length - 1]);
    const sPrevFull = worldToScreen(poly[poly.length - 2]);
    const angH = Math.atan2(sEndFull.y - sPrevFull.y, sEndFull.x - sPrevFull.x);
    const hL = sw * 2.4;
    const barThick = Math.max(1, sw * 0.6);
    const tip = sEndFull;

    // Arah bar A (back-left) = angH + 3π/4, bar B (back-right) = angH − 3π/4.
    // Perp outward untuk masing-masing = angH ± π/4 (menjauh dari sumbu panah).
    const angA = angH + (3 * Math.PI) / 4;
    const angB = angH - (3 * Math.PI) / 4;
    const perpA = angH + Math.PI / 4;
    const perpB = angH - Math.PI / 4;
    const dA = { x: Math.cos(angA), y: Math.sin(angA) };
    const dB = { x: Math.cos(angB), y: Math.sin(angB) };
    const nA = { x: Math.cos(perpA), y: Math.sin(perpA) };
    const nB = { x: Math.cos(perpB), y: Math.sin(perpB) };

    // Shaft: berhenti tepat di tip (bar akan menutupi ujung dash).
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.setLineDash([sw * 0.5, sw * 0.3]);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = sw;
    ctx.beginPath();
    const s0 = worldToScreen(poly[0]); ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < poly.length - 1; i++) { const s = worldToScreen(poly[i]); ctx.lineTo(s.x, s.y); }
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dua bar bertemu tepat di tip (satu titik bersama = sudut siku tersambung).
    ctx.fillStyle = a.color;
    const drawBar = (d: { x: number; y: number }, n: { x: number; y: number }) => {
      const p1 = { x: tip.x, y: tip.y };
      const p2 = { x: tip.x + d.x * hL, y: tip.y + d.y * hL };
      const p3 = { x: p2.x + n.x * barThick, y: p2.y + n.y * barThick };
      const p4 = { x: tip.x + n.x * barThick, y: tip.y + n.y * barThick };
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fill();
    };
    drawBar(dA, nA);
    drawBar(dB, nB);
    ctx.restore();
    return;
  }


  ctx.strokeStyle = withAlpha(a.color, 0.55);
  ctx.lineWidth = sw;
  ctx.beginPath();
  const s0 = worldToScreen(poly[0]); ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < poly.length; i++) { const s = worldToScreen(poly[i]); ctx.lineTo(s.x, s.y); }
  ctx.stroke();
  ctx.setLineDash([]);
  // arrowhead at last point (arrow biasa — segitiga)
  const sEnd = worldToScreen(poly[poly.length - 1]);
  const sPrev = worldToScreen(poly[poly.length - 2]);
  const ang = Math.atan2(sEnd.y - sPrev.y, sEnd.x - sPrev.x);
  const hs = Math.max(14, sw * 1.6);
  ctx.fillStyle = withAlpha(a.color, 0.85);
  ctx.beginPath();
  ctx.moveTo(sEnd.x, sEnd.y);
  ctx.lineTo(sEnd.x - Math.cos(ang - 0.42) * hs, sEnd.y - Math.sin(ang - 0.42) * hs);
  ctx.lineTo(sEnd.x - Math.cos(ang + 0.42) * hs, sEnd.y - Math.sin(ang + 0.42) * hs);
  ctx.closePath(); ctx.fill();
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
  // React imported at top of module.

  if (a.kind === "node" || a.kind === "access") {
    const p = worldToScreen(a.points[0]);
    const r = (a.kind === "node" ? 14 : 16) * scale;
    nodes.push(React.createElement("circle", { key: `${keyPrefix}-c`, cx: p.x, cy: p.y, r, fill: "none", stroke: a.color, strokeWidth: sw }));
    if (a.kind === "node") {
      nodes.push(React.createElement("circle", { key: `${keyPrefix}-d`, cx: p.x, cy: p.y, r: r * 0.35, fill: a.color }));
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * i) / 6;
        nodes.push(React.createElement("line", {
          key: `${keyPrefix}-s${i}`,
          x1: p.x + Math.cos(ang) * r * 0.9, y1: p.y + Math.sin(ang) * r * 0.9,
          x2: p.x - Math.cos(ang) * r * 0.9, y2: p.y - Math.sin(ang) * r * 0.9,
          stroke: a.color, strokeWidth: sw * 0.7, strokeLinecap: "round",
        }));
      }
    }
    return nodes;
  }

  if (a.kind === "label") {
    const p = worldToScreen(a.points[0]);
    const txt = a.text || "Label";
    const fs = 12 * scale;
    const boxH = 20 * scale;
    nodes.push(React.createElement("line", { key: `${keyPrefix}-l`, x1: p.x, y1: p.y, x2: p.x + 10, y2: p.y, stroke: a.color, strokeWidth: 1 }));
    nodes.push(React.createElement("circle", { key: `${keyPrefix}-a`, cx: p.x, cy: p.y, r: 3, fill: a.color }));
    nodes.push(React.createElement("rect", { key: `${keyPrefix}-b`, x: p.x + 10, y: p.y - boxH / 2, width: Math.max(28, txt.length * fs * 0.6 + 12), height: boxH, fill: "rgba(255,255,255,0.9)", stroke: a.color }));
    nodes.push(React.createElement("text", { key: `${keyPrefix}-t`, x: p.x + 16, y: p.y + fs * 0.35, fill: a.color, fontSize: fs, fontWeight: 600, style: { fontFamily: "Manrope, sans-serif" } }, txt));
    return nodes;
  }

  const poly = annotationPolyline(a);
  if (poly.length < 2) return nodes;
  const pts = poly.map(worldToScreen);
  const d = "M " + pts.map((p) => `${p.x} ${p.y}`).join(" L ");

  if (a.kind === "zone") {
    nodes.push(React.createElement("path", { key: `${keyPrefix}-p`, d: d + " Z", fill: withAlpha(a.color, 0.32), stroke: withAlpha(a.color, 0.9), strokeWidth: sw }));
    return nodes;
  }
  if (a.kind === "flow" || a.kind === "border") {
    const dash = a.kind === "flow" ? `${Math.max(6, sw * 1.6)},${Math.max(4, sw * 1.0)}` : `${Math.max(6, sw * 4)},${Math.max(4, sw * 3)}`;
    const dd = a.kind === "border" ? d + " Z" : d;
    nodes.push(React.createElement("path", { key: `${keyPrefix}-p`, d: dd, fill: "none", stroke: a.color, strokeWidth: sw, strokeDasharray: dash, strokeLinecap: "round" }));
    return nodes;
  }
  // arrow / arrowDashed
  if (a.kind === "arrowDashed") {
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const angH = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    const hL = sw * 2.4;
    const barThick = Math.max(1, sw * 0.6);
    const shaftPts = [...pts.slice(0, -1), tip];
    const dShaft = "M " + shaftPts.map((p) => `${p.x} ${p.y}`).join(" L ");
    nodes.push(React.createElement("path", {
      key: `${keyPrefix}-p`, d: dShaft, fill: "none", stroke: a.color, strokeWidth: sw,
      strokeLinecap: "butt", strokeLinejoin: "miter",
      strokeDasharray: `${sw * 0.5},${sw * 0.3}`,
    }));
    // Dua bar bertemu tepat di tip (satu titik bersama = siku tersambung).
    const angA = angH + (3 * Math.PI) / 4;
    const angB = angH - (3 * Math.PI) / 4;
    const perpA = angH + Math.PI / 4;
    const perpB = angH - Math.PI / 4;
    const barPath = (dRad: number, nRad: number, key: string) => {
      const dx = Math.cos(dRad), dy = Math.sin(dRad);
      const nx = Math.cos(nRad), ny = Math.sin(nRad);
      const p1 = tip;
      const p2 = { x: tip.x + dx * hL, y: tip.y + dy * hL };
      const p3 = { x: p2.x + nx * barThick, y: p2.y + ny * barThick };
      const p4 = { x: tip.x + nx * barThick, y: tip.y + ny * barThick };
      const dd = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} L ${p4.x} ${p4.y} Z`;
      nodes.push(React.createElement("path", { key, d: dd, fill: a.color, stroke: "none" }));
    };
    barPath(angA, perpA, `${keyPrefix}-h1`);
    barPath(angB, perpB, `${keyPrefix}-h2`);
    return nodes;
  }


  const mid = `${keyPrefix}-am`;
  nodes.push(React.createElement("defs", { key: `${keyPrefix}-def` },
    React.createElement("marker", {
      id: mid, viewBox: "0 0 12 12", refX: 8, refY: 6, markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse",
    }, React.createElement("path", { d: "M 0 0 L 12 6 L 0 12 z", fill: a.color })),
  ));
  nodes.push(React.createElement("path", { key: `${keyPrefix}-p`, d, fill: "none", stroke: withAlpha(a.color, 0.65), strokeWidth: sw, strokeLinecap: "round", markerEnd: `url(#${mid})` }));
  return nodes;
}
