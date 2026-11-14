import type { LibraryMaterial, MaterialKind } from "@/lib/material-library";
import { rksCodeKey, rksOutlineRows, type RksAsset, type RksMaterialImages } from "@/lib/rks-document";
import type { SpecSketch } from "@/lib/spec-outline";

/** Browser-only helpers: redraw images through a canvas so Word receives JPEG/PNG parts. */
async function loadImage(src: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.src = src;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

function canvasAsset(canvas: HTMLCanvasElement, mime: "image/jpeg" | "image/png", width: number, height: number): RksAsset | null {
  try {
    const url = canvas.toDataURL(mime, 0.86);
    const base64 = url.slice(url.indexOf(",") + 1);
    return base64 ? { mime, base64, width, height } : null;
  } catch {
    return null;
  }
}

function drawCover(img: HTMLImageElement, width: number, height: number, scale: number): RksAsset | null {
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ratio = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = img.naturalWidth * ratio, h = img.naturalHeight * ratio;
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return canvasAsset(canvas, "image/jpeg", width, height);
}

function drawFit(img: HTMLImageElement, maxWidth: number, maxHeight: number, scale: number): RksAsset | null {
  const ratio = Math.min(1, maxWidth / img.naturalWidth, maxHeight / img.naturalHeight);
  const width = Math.max(1, Math.round(img.naturalWidth * ratio));
  const height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasAsset(canvas, "image/jpeg", width, height);
}

/** Same shapes as the slide: circle = lantai, ellipse = plafon, triangle = dinding, box = others. */
function drawCodeSymbol(kind: MaterialKind, code: string): RksAsset | null {
  const scale = 4;
  const height = 30;
  const width = kind === "plafon" ? 37 : kind === "lantai" || kind === "dinding" ? 30 : Math.max(30, 12 + code.length * 8);
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  let textY = height / 2;
  if (kind === "lantai") ctx.arc(15, 15, 11.7, 0, Math.PI * 2);
  else if (kind === "plafon") ctx.ellipse(width / 2, 15, 15, 10, 0, 0, Math.PI * 2);
  else if (kind === "dinding") { ctx.moveTo(4.2, 25); ctx.lineTo(15, 4.2); ctx.lineTo(25.8, 25); ctx.closePath(); textY = 18.4; }
  else ctx.rect(1.5, 1.5, width - 3, height - 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#111111";
  ctx.font = `700 ${kind === "lantai" || kind === "dinding" || kind === "plafon" ? 8.3 : 11}px "Times New Roman", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(code, width / 2, textY);
  return canvasAsset(canvas, "image/png", width, height);
}

export async function prepareRksAssets(sketch: SpecSketch, materials: LibraryMaterial[]) {
  const rows = rksOutlineRows(sketch, materials);
  const materialImages = new Map<string, RksMaterialImages>();
  const codeImages = new Map<string, RksAsset>();
  for (const row of rows) {
    const key = rksCodeKey(row.ref.kind, row.code);
    if (!codeImages.has(key)) {
      const symbol = drawCodeSymbol(row.ref.kind, row.code);
      if (symbol) codeImages.set(key, symbol);
    }
    const material = row.material;
    if (!material?.image || materialImages.has(material.id)) continue;
    const img = await loadImage(material.image);
    if (!img || !img.naturalWidth) continue;
    materialImages.set(material.id, {
      thumb: drawCover(img, 78, 66, 2) ?? undefined,
      preview: drawFit(img, 260, 200, 2) ?? undefined,
    });
  }
  return { materialImages, codeImages };
}
