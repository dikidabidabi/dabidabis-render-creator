// Ekspor Panel Sayembara ke Photoshop (.psd) berukuran A1/A2 pada 150 dpi.
// Gambar tiap kotak menjadi layer terpisah, teks menjadi layer teks asli
// (dapat diedit di Photoshop). Hanya untuk browser: memakai canvas.
import type { Layer, Psd } from "ag-psd";
import {
  PANEL_COLORS, PANEL_PSD_DPI, PANEL_TYPE, fitPanelFontSize, panelPageGeometry, panelPaperPixels,
  type PanelBox, type PanelLayout, type PanelOrientation, type PanelPaper, type PanelText,
} from "@/lib/competition-panels";

export type PsdPanelInput = {
  name: string;
  number: number;
  total: number;
  projectTitle: string;
  layout: PanelLayout;
  texts: PanelText[];
  cells: Array<{ label: string; image: HTMLCanvasElement | null }>;
  paper: PanelPaper;
  orientation: PanelOrientation;
};

const FONT = "Arial, Helvetica, sans-serif";

function newCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function rgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

type TextOpts = { size: number; bold?: boolean; color?: string; align?: "left" | "right" | "center"; spacing?: number };

export async function buildPanelPsd(input: PsdPanelInput): Promise<Blob> {
  const { writePsd } = await import("ag-psd");
  const { w: W, h: H } = panelPaperPixels(input.paper, input.orientation);
  const g = panelPageGeometry(input.layout, W, H);
  const u = g.unit;
  const composite = newCanvas(W, H);
  const cx = composite.getContext("2d")!;
  cx.fillStyle = PANEL_COLORS.page;
  cx.fillRect(0, 0, W, H);

  const rectLayer = (name: string, box: PanelBox, fill: string | null, stroke?: { color: string; width: number; dash?: number[] }): Layer => {
    const c = newCanvas(box.w, box.h);
    const ctx = c.getContext("2d")!;
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, c.width, c.height); }
    if (stroke) {
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      if (stroke.dash) ctx.setLineDash(stroke.dash);
      ctx.strokeRect(stroke.width / 2, stroke.width / 2, c.width - stroke.width, c.height - stroke.width);
    }
    cx.drawImage(c, Math.round(box.x), Math.round(box.y));
    return { name, left: Math.round(box.x), top: Math.round(box.y), canvas: c };
  };

  const textLayer = (name: string, text: string, box: PanelBox, o: TextOpts): Layer => {
    const c = newCanvas(box.w, box.h);
    const ctx = c.getContext("2d")!;
    const lh = o.size * PANEL_TYPE.lineHeight;
    ctx.font = `${o.bold ? "700 " : ""}${o.size}px ${FONT}`;
    ctx.fillStyle = o.color ?? PANEL_COLORS.ink;
    ctx.textBaseline = "top";
    ctx.textAlign = o.align ?? "left";
    const ax = o.align === "right" ? c.width : o.align === "center" ? c.width / 2 : 0;
    wrapLines(ctx, text, c.width).forEach((line, i) => {
      if ((i + 1) * lh <= c.height + o.size * 0.3) ctx.fillText(line, ax, i * lh + (lh - o.size) / 2);
    });
    cx.drawImage(c, Math.round(box.x), Math.round(box.y));
    return {
      name,
      left: Math.round(box.x),
      top: Math.round(box.y),
      canvas: c,
      text: {
        text,
        transform: [1, 0, 0, 1, Math.round(box.x), Math.round(box.y)],
        antiAlias: "smooth",
        shapeType: "box",
        boxBounds: [0, 0, Math.round(box.w), Math.round(box.h)],
        style: {
          font: { name: o.bold ? "Arial-BoldMT" : "ArialMT" },
          fontSize: Math.round(o.size * 10) / 10,
          autoLeading: false,
          leading: Math.round(lh * 10) / 10,
          fillColor: rgb(o.color ?? PANEL_COLORS.ink),
          ...(o.spacing ? { tracking: o.spacing } : {}),
        },
        paragraphStyle: { justification: o.align ?? "left" },
      },
    };
  };

  const frames: Layer[] = [];
  const images: Layer[] = [];
  const texts: Layer[] = [];
  const nn = String(input.number).padStart(2, "0");

  // Kepala panel
  const hd = g.header;
  texts.push(textLayer("Kicker", `PANEL ${nn} · SAYEMBARA`, { x: hd.x, y: hd.y, w: hd.w * 0.6, h: PANEL_TYPE.kicker * 1.6 * u }, { size: PANEL_TYPE.kicker * u, bold: true, color: PANEL_COLORS.accent, spacing: 200 }));
  texts.push(textLayer("Judul Panel", input.name.toUpperCase(), { x: hd.x, y: hd.y + PANEL_TYPE.kicker * 1.8 * u, w: hd.w * 0.66, h: PANEL_TYPE.title * 1.5 * u }, { size: PANEL_TYPE.title * u, bold: true }));
  texts.push(textLayer("Judul Proyek", input.projectTitle, { x: hd.x + hd.w * 0.62, y: hd.y + PANEL_TYPE.kicker * 1.8 * u, w: hd.w * 0.38, h: PANEL_TYPE.project * 3 * u }, { size: PANEL_TYPE.project * u, bold: true, align: "right" }));
  frames.push(rectLayer("Garis Kepala", { x: hd.x, y: hd.y + hd.h - 3 * u, w: hd.w, h: 3 * u }, PANEL_COLORS.ink));

  // Kotak gambar
  const capH = PANEL_TYPE.captionH * u;
  g.slots.forEach((box, i) => {
    const cell = input.cells[i];
    const imgBox = { x: box.x, y: box.y, w: box.w, h: box.h - capH };
    if (cell?.image) {
      const c = newCanvas(imgBox.w, imgBox.h);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      const s = Math.min(c.width / cell.image.width, c.height / cell.image.height);
      const dw = cell.image.width * s, dh = cell.image.height * s;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cell.image, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      cx.drawImage(c, Math.round(imgBox.x), Math.round(imgBox.y));
      images.push({ name: `${String(i + 1).padStart(2, "0")} · ${cell.label}`, left: Math.round(imgBox.x), top: Math.round(imgBox.y), canvas: c });
      frames.push(rectLayer(`Bingkai ${i + 1}`, imgBox, null, { color: PANEL_COLORS.border, width: Math.max(1, u) }));
    } else {
      frames.push(rectLayer(`Kotak kosong ${i + 1}`, imgBox, null, { color: PANEL_COLORS.border, width: Math.max(1, u * 1.5), dash: [8 * u, 6 * u] }));
    }
    if (cell) texts.push(textLayer(`Keterangan ${i + 1}`, cell.label.toUpperCase(), { x: box.x, y: box.y + box.h - capH + 4 * u, w: box.w, h: capH - 4 * u }, { size: PANEL_TYPE.caption * u, bold: true, color: PANEL_COLORS.muted, spacing: 60 }));
  });

  // Kotak teks penjelasan
  g.texts.forEach((box, i) => {
    const t = input.texts[i] ?? { title: "", body: "" };
    const pad = PANEL_TYPE.pad * u;
    frames.push(rectLayer(`Latar Teks ${i + 1}`, box, PANEL_COLORS.textBg));
    frames.push(rectLayer(`Aksen Teks ${i + 1}`, { x: box.x, y: box.y, w: PANEL_TYPE.accent * u, h: box.h }, PANEL_COLORS.accent));
    const inner = { x: box.x + pad + PANEL_TYPE.accent * u, y: box.y + pad, w: box.w - pad * 2 - PANEL_TYPE.accent * u, h: box.h - pad * 2 };
    const titleH = t.title ? PANEL_TYPE.textTitle * 1.7 * u : 0;
    if (t.title) texts.push(textLayer(`Judul Teks ${i + 1}`, t.title, { ...inner, h: titleH }, { size: PANEL_TYPE.textTitle * u, bold: true }));
    const bodyBox = { x: inner.x, y: inner.y + titleH, w: inner.w, h: Math.max(10, inner.h - titleH) };
    const fs = fitPanelFontSize(t.body, bodyBox.w, bodyBox.h, PANEL_TYPE.bodyMax * u, PANEL_TYPE.bodyMin * u);
    texts.push(textLayer(`Isi Teks ${i + 1}`, t.body, bodyBox, { size: fs }));
  });

  // Kaki panel
  const ft = g.footer;
  frames.push(rectLayer("Garis Kaki", { x: ft.x, y: ft.y, w: ft.w, h: Math.max(1, u) }, PANEL_COLORS.border));
  texts.push(textLayer("Kaki Kiri", `Dabidabi's · ${input.projectTitle}`, { x: ft.x, y: ft.y + 6 * u, w: ft.w * 0.6, h: ft.h - 6 * u }, { size: PANEL_TYPE.footer * u, color: PANEL_COLORS.muted }));
  texts.push(textLayer("Kaki Kanan", `${input.paper} · ${input.orientation === "portrait" ? "Potret" : "Lanskap"} · ${nn}/${String(input.total).padStart(2, "0")}`, { x: ft.x + ft.w * 0.5, y: ft.y + 6 * u, w: ft.w * 0.5, h: ft.h - 6 * u }, { size: PANEL_TYPE.footer * u, color: PANEL_COLORS.muted, align: "right" }));

  const bg = newCanvas(W, H);
  const bctx = bg.getContext("2d")!;
  bctx.fillStyle = PANEL_COLORS.page;
  bctx.fillRect(0, 0, W, H);

  const psd: Psd = {
    width: W,
    height: H,
    canvas: composite,
    imageResources: {
      resolutionInfo: {
        horizontalResolution: PANEL_PSD_DPI, horizontalResolutionUnit: "PPI", widthUnit: "Centimeters",
        verticalResolution: PANEL_PSD_DPI, verticalResolutionUnit: "PPI", heightUnit: "Centimeters",
      },
    },
    children: [
      { name: "Latar", left: 0, top: 0, canvas: bg },
      { name: "Bingkai & Latar Teks", opened: true, children: frames },
      { name: "Gambar", opened: true, children: images },
      { name: "Teks (dapat diedit)", opened: true, children: texts },
    ],
  };
  const buffer = writePsd(psd, { invalidateTextLayers: true, generateThumbnail: true });
  bg.width = 0; bg.height = 0; composite.width = 0; composite.height = 0;
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
