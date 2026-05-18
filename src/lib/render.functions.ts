import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decode as decodePng, encode as encodePng } from "fast-png";
import * as jpeg from "jpeg-js";
import { z } from "zod";

const RENDER_TYPE_PROMPTS: Record<string, string> = {
  exterior:
    "Render sebagai foto eksterior arsitektur fotorealistis profesional. Pencahayaan natural golden hour, material realistis (beton, kayu, kaca, baja), refleksi akurat, langit dramatis, vegetasi sekitar yang menyatu, depth of field halus. Kualitas portfolio arsitek kelas atas.",
  interior:
    "Render sebagai foto interior fotorealistis berkualitas majalah. Pencahayaan ambient lembut, furniture kontemporer yang sesuai, tekstur material akurat (kayu, marmer, kain, logam), highlight dan bayangan natural, depth of field sinematik.",
  night:
    "Render sebagai night shot arsitektur dramatis. Pencahayaan buatan dari interior memancar hangat, lampu landscape strategis, langit malam biru tua dengan sedikit bintang, refleksi cahaya pada material kaca dan basah, mood sinematik high-end.",
  watercolor:
    "Render sebagai ilustrasi cat air arsitektur artistik. Wash warna lembut, garis kontur tinta tipis, tekstur kertas terlihat, akurasi proporsi tetap terjaga, palet warna tenang dan elegan, gaya presentasi konsep arsitek.",
};

const InputSchema = z.object({
  sketchBase64: z.string().min(10),
  referenceBase64: z.string().nullable().optional(),
  prompt: z.string().min(1).max(2000),
  renderType: z.enum(["exterior", "interior", "night", "watercolor"]),
  accuracy: z.number().int().min(1).max(10),
  consistency: z.number().int().min(1).max(10),
  seed: z.number().int().min(0).max(2147483647).nullable().optional(),
  resolution: z.enum(["1k", "2k", "4k", "8k"]).default("1k").optional(),
});

const RESOLUTION_SPECS: Record<string, { label: string; longEdge: number }> = {
  "1k": { label: "1K (1024px)", longEdge: 1024 },
  "2k": { label: "2K (2048px)", longEdge: 2048 },
  "4k": { label: "4K (3840px)", longEdge: 3840 },
  "8k": { label: "8K (7680px)", longEdge: 7680 },
};

// Direct Google Gemini API (Google AI Studio) — model image-generation terbaru.
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image-preview";
import { GEMINI_API_KEY } from "@/config/apiConfig";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

type GeminiPart = { text?: string; inline_data?: { mime_type: string; data: string } };

function dataUrlToInlinePart(dataUrl: string): GeminiPart | null {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

async function callGeminiImage(
  parts: GeminiPart[],
): Promise<{ ok: true; dataUrl: string } | { ok: false; status: number; error: string }> {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "ISI_API_KEY_DISINI") {
    return { ok: false, status: 0, error: "GEMINI_API_KEY belum diisi di src/config/apiConfig.ts" };
  }
  const resp = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, error: text.slice(0, 400) };
  }
  const json = await resp.json();
  const respParts: Array<Record<string, unknown>> =
    json?.candidates?.[0]?.content?.parts ?? [];
  for (const p of respParts) {
    const inline = (p?.inline_data ?? (p as { inlineData?: { mime_type?: string; mimeType?: string; data?: string } }).inlineData) as
      | { mime_type?: string; mimeType?: string; data?: string }
      | undefined;
    if (inline?.data) {
      const mt = inline.mime_type ?? inline.mimeType ?? "image/png";
      return { ok: true, dataUrl: `data:${mt};base64,${inline.data}` };
    }
  }
  return { ok: false, status: 200, error: "Gemini tidak mengembalikan gambar" };
}

type RgbaImage = { width: number; height: number; data: Uint8Array };

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

function decodeImage(bytes: Uint8Array, mime: string): RgbaImage {
  if (mime.includes("jpeg") || mime.includes("jpg")) {
    const decoded = jpeg.decode(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: true,
      maxResolutionInMP: 80,
      maxMemoryUsageInMB: 512,
    });
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }

  const decoded = decodePng(bytes);
  const source = decoded.data;
  const channels = decoded.channels;
  const rgba = new Uint8Array(decoded.width * decoded.height * 4);
  const to8Bit = (value: number) => (decoded.depth === 16 ? Math.round(value / 257) : value);

  for (let i = 0, p = 0; i < decoded.width * decoded.height; i++, p += 4) {
    const s = i * channels;
    if (channels === 1) {
      const gray = to8Bit(source[s]);
      rgba[p] = gray;
      rgba[p + 1] = gray;
      rgba[p + 2] = gray;
      rgba[p + 3] = 255;
    } else if (channels === 2) {
      const gray = to8Bit(source[s]);
      rgba[p] = gray;
      rgba[p + 1] = gray;
      rgba[p + 2] = gray;
      rgba[p + 3] = to8Bit(source[s + 1]);
    } else {
      rgba[p] = to8Bit(source[s]);
      rgba[p + 1] = to8Bit(source[s + 1]);
      rgba[p + 2] = to8Bit(source[s + 2]);
      rgba[p + 3] = channels === 4 ? to8Bit(source[s + 3]) : 255;
    }
  }

  return { width: decoded.width, height: decoded.height, data: rgba };
}

function cubicWeight(distance: number) {
  const a = -0.5;
  const x = Math.abs(distance);
  if (x <= 1) return (a + 2) * x ** 3 - (a + 3) * x ** 2 + 1;
  if (x < 2) return a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a;
  return 0;
}

function buildAxisMap(sourceSize: number, targetSize: number) {
  const indices = new Int32Array(targetSize * 4);
  const weights = new Float32Array(targetSize * 4);
  const scale = sourceSize / targetSize;

  for (let target = 0; target < targetSize; target++) {
    const source = (target + 0.5) * scale - 0.5;
    const base = Math.floor(source);
    let total = 0;

    for (let tap = 0; tap < 4; tap++) {
      const sourceIndex = base + tap - 1;
      const mapIndex = target * 4 + tap;
      indices[mapIndex] = Math.max(0, Math.min(sourceSize - 1, sourceIndex));
      const weight = cubicWeight(source - sourceIndex);
      weights[mapIndex] = weight;
      total += weight;
    }

    if (total !== 0) {
      for (let tap = 0; tap < 4; tap++) weights[target * 4 + tap] /= total;
    }
  }

  return { indices, weights };
}

function resizeBicubic(image: RgbaImage, scale: number): RgbaImage {
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));
  const xMap = buildAxisMap(image.width, targetWidth);
  const yMap = buildAxisMap(image.height, targetHeight);
  const output = new Uint8Array(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y++) {
    const yMapOffset = y * 4;
    for (let x = 0; x < targetWidth; x++) {
      const xMapOffset = x * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let yy = 0; yy < 4; yy++) {
        const sourceY = yMap.indices[yMapOffset + yy];
        const wy = yMap.weights[yMapOffset + yy];
        const row = sourceY * image.width * 4;
        for (let xx = 0; xx < 4; xx++) {
          const sourceX = xMap.indices[xMapOffset + xx];
          const weight = wy * xMap.weights[xMapOffset + xx];
          const sourceIndex = row + sourceX * 4;
          r += image.data[sourceIndex] * weight;
          g += image.data[sourceIndex + 1] * weight;
          b += image.data[sourceIndex + 2] * weight;
          a += image.data[sourceIndex + 3] * weight;
        }
      }

      const targetIndex = (y * targetWidth + x) * 4;
      output[targetIndex] = clampByte(r);
      output[targetIndex + 1] = clampByte(g);
      output[targetIndex + 2] = clampByte(b);
      output[targetIndex + 3] = clampByte(a);
    }
  }

  return { width: targetWidth, height: targetHeight, data: output };
}

function sharpenImage(image: RgbaImage, amount: number): RgbaImage {
  const output = new Uint8Array(image.data);
  const stride = image.width * 4;

  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const i = y * stride + x * 4;
      for (let c = 0; c < 3; c++) {
        const center = image.data[i + c];
        const neighborAverage =
          (image.data[i - 4 + c] +
            image.data[i + 4 + c] +
            image.data[i - stride + c] +
            image.data[i + stride + c]) /
          4;
        output[i + c] = clampByte(center + (center - neighborAverage) * amount);
      }
    }
  }

  return { ...image, data: output };
}

function detailMicroOnly(image: RgbaImage): RgbaImage {
  return sharpenImage(image, 0.78);
}

function lumaAt(image: RgbaImage, x: number, y: number) {
  const i = (y * image.width + x) * 4;
  return image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
}

function preservesTileStructure(source: RgbaImage, candidate: RgbaImage) {
  if (source.width !== candidate.width || source.height !== candidate.height) return false;

  let samples = 0;
  let strongColorShift = 0;
  let newEdgesInFlatArea = 0;
  const step = Math.max(1, Math.floor(Math.min(source.width, source.height) / 220));

  for (let y = 1; y < source.height - 1; y += step) {
    for (let x = 1; x < source.width - 1; x += step) {
      samples++;
      const i = (y * source.width + x) * 4;
      const colorDiff =
        Math.abs(source.data[i] - candidate.data[i]) +
        Math.abs(source.data[i + 1] - candidate.data[i + 1]) +
        Math.abs(source.data[i + 2] - candidate.data[i + 2]);
      if (colorDiff > 92) strongColorShift++;

      const sourceEdge =
        Math.abs(lumaAt(source, x + 1, y) - lumaAt(source, x - 1, y)) +
        Math.abs(lumaAt(source, x, y + 1) - lumaAt(source, x, y - 1));
      const candidateEdge =
        Math.abs(lumaAt(candidate, x + 1, y) - lumaAt(candidate, x - 1, y)) +
        Math.abs(lumaAt(candidate, x, y + 1) - lumaAt(candidate, x, y - 1));
      if (sourceEdge < 18 && candidateEdge > 58) newEdgesInFlatArea++;
    }
  }

  return strongColorShift / samples < 0.045 && newEdgesInFlatArea / samples < 0.018;
}

function touchupBottomRightLogo(image: RgbaImage): RgbaImage {
  const output = new Uint8Array(image.data);
  const marginX = Math.round(image.width * 0.012);
  const marginY = Math.round(image.height * 0.016);
  const regionWidth = Math.max(80, Math.round(image.width * 0.2));
  const regionHeight = Math.max(36, Math.round(image.height * 0.11));
  const x0 = Math.max(0, image.width - regionWidth - marginX);
  const y0 = Math.max(0, image.height - regionHeight - marginY);
  const x1 = Math.max(x0 + 1, image.width - marginX);
  const y1 = Math.max(y0 + 1, image.height - marginY);
  const feather = Math.max(8, Math.round(Math.min(regionWidth, regionHeight) * 0.22));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const edgeDistance = Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y);
      const blend = Math.max(0, Math.min(1, edgeDistance / feather));
      const smoothBlend = blend * blend * (3 - 2 * blend);
      if (smoothBlend <= 0) continue;

      const sxA = Math.max(0, Math.min(image.width - 1, Math.round(x - regionWidth * 0.86)));
      const syA = Math.max(0, Math.min(image.height - 1, Math.round(y - regionHeight * 0.12)));
      const sxB = Math.max(0, Math.min(image.width - 1, Math.round(x - regionWidth * 0.18)));
      const syB = Math.max(0, Math.min(image.height - 1, Math.round(y - regionHeight * 1.08)));
      const target = (y * image.width + x) * 4;
      const sampleA = (syA * image.width + sxA) * 4;
      const sampleB = (syB * image.width + sxB) * 4;

      for (let c = 0; c < 3; c++) {
        const patch = image.data[sampleA + c] * 0.65 + image.data[sampleB + c] * 0.35;
        output[target + c] = clampByte(image.data[target + c] * (1 - smoothBlend) + patch * smoothBlend);
      }
    }
  }

  return { ...image, data: output };
}

// TAHAP 2: pixel upscale 2-5x bicubic (NO sharpening here — sharpening dilakukan AI per tile di Tahap 4)
function upscaleOnly(image: RgbaImage, resolutionKey: string): RgbaImage {
  if (resolutionKey === "1k") return image;
  const targetLongEdge = RESOLUTION_SPECS[resolutionKey]?.longEdge ?? RESOLUTION_SPECS["1k"].longEdge;
  const currentLongEdge = Math.max(image.width, image.height);
  const scale = Math.min(10, Math.max(2, targetLongEdge / currentLongEdge));
  return resizeBicubic(image, scale);
}

// --- Tile-based AI super-resolution helpers ---

function cropTile(image: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  const srcStride = image.width * 4;
  for (let row = 0; row < h; row++) {
    const srcOffset = (y + row) * srcStride + x * 4;
    const dstOffset = row * w * 4;
    data.set(image.data.subarray(srcOffset, srcOffset + w * 4), dstOffset);
  }
  return { width: w, height: h, data };
}

function pasteTileExact(
  canvas: RgbaImage,
  tile: RgbaImage,
  destX: number,
  destY: number,
) {
  const cw = canvas.width;
  const tw = tile.width;
  const th = tile.height;
  for (let y = 0; y < th; y++) {
    const ti = y * tw * 4;
    const ci = ((destY + y) * cw + destX) * 4;
    canvas.data.set(tile.data.subarray(ti, ti + tw * 4), ci);
  }
}

function rgbaToJpegDataUrl(image: RgbaImage, quality = 90): string {
  const encoded = jpeg.encode(
    { width: image.width, height: image.height, data: image.data },
    quality,
  );
  // Manual base64 encode (Worker-safe)
  let binary = "";
  const bytes = encoded.data;
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as number[]);
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

function dataUrlToRgba(dataUrl: string): RgbaImage | null {
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return decodeImage(bytes, m[1]);
  } catch {
    return null;
  }
}

// PROMPT KONSTAN — identik untuk SEMUA 16 tile, tanpa variasi konteks per tile.
// Ini menjamin AI menerapkan metode & intensitas sharpening yang sama persis
// pada setiap tile sehingga tidak terlihat perbedaan kualitas antar bagian.
const TILE_ENHANCE_PROMPT = `MODE: NON-GENERATIVE IMAGE FILTER ONLY.
Tugas: pertajam gambar ini secara sangat ringan seperti filter kamera (unsharp mask + local contrast). Ini adalah SATU TILE / kuadran kecil dari gambar render arsitektur yang lebih besar.

ATURAN MUTLAK (WAJIB DIPATUHI):
- INPUT ADALAH MASTER SHAPE. Semua pixel harus tetap berada pada posisi visual yang sama.
- DILARANG TOTAL menambah bentuk, objek, ornamen, furniture, tanaman, manusia, kendaraan, jendela, pintu, garis, teks, logo, watermark, bayangan baru, pantulan baru, atau elemen baru sekecil apapun.
- DILARANG menghapus, mengganti, menggeser, memperbesar, mengecilkan, meluruskan, membengkokkan, atau menyambung bentuk/objek yang sudah ada.
- DILARANG mengubah kontur, siluet, geometri, proporsi, perspektif, komposisi, framing, crop, warna dominan, palet, pencahayaan, material, dan sudut pandang.
- DILARANG re-style, re-render ulang, inpaint, outpaint, hallucinate, atau interpretasi kreatif.
- Output WAJIB beresolusi dan framing IDENTIK dengan input — anggap ini hanya proses sharpening, bukan pembuatan gambar baru.
- HANYA BOLEH: menaikkan ketajaman tepi yang SUDAH ADA, kontras lokal halus, dan tekstur mikro pada material yang SUDAH ADA tanpa mengubah bentuk materialnya.
- DILARANG menambahkan watermark, logo, teks, signature, tanda "AI", "Gemini", "Google", atau marka apapun.
- Bila ragu, pertahankan pixel asli. Output harus terlihat seperti input yang sedikit lebih tajam, bukan versi baru.`;

async function enhanceTileWithAI(
  tile: RgbaImage,
  _apiKey: string,
): Promise<RgbaImage | null> {
  const inputUrl = rgbaToJpegDataUrl(tile, 92);
  try {
    const inlinePart = dataUrlToInlinePart(inputUrl);
    if (!inlinePart) return null;
    const result = await callGeminiImage([
      { text: TILE_ENHANCE_PROMPT },
      inlinePart,
    ]);
    if (!result.ok) return null;
    const decoded = dataUrlToRgba(result.dataUrl);
    if (!decoded) return null;
    // Resize back to tile dims if AI returned different size
    if (decoded.width !== tile.width || decoded.height !== tile.height) {
      const scaleX = tile.width / decoded.width;
      const scaleY = tile.height / decoded.height;
      const scale = (scaleX + scaleY) / 2;
      const resized = resizeBicubic(decoded, scale);
      // pad/crop to exact tile size
      if (resized.width === tile.width && resized.height === tile.height) return resized;
      return cropTile(resized, 0, 0, Math.min(resized.width, tile.width), Math.min(resized.height, tile.height));
    }
    return decoded;
  } catch {
    return null;
  }
}

// Enhancement deterministik IDENTIK untuk semua tile — parameter konstan,
// tidak melibatkan AI per tile, sehingga setiap tile diproses dengan rumus
// yang sama persis. Ini menghilangkan perbedaan kualitas antar tile.
function uniformTileEnhance(tile: RgbaImage): RgbaImage {
  // Unsharp mask amount tetap (sama untuk semua tile, semua resolusi).
  return sharpenImage(tile, 0.55);
}

// Paste tile dengan feathered blending HANYA di area overlap (1% dari sisi tile).
// Area inti tile (di luar overlap) di-set langsung tanpa blending.
function pasteTileFeathered(
  canvas: RgbaImage,
  tile: RgbaImage,
  destX: number,
  destY: number,
  featherLeft: number,
  featherTop: number,
  featherRight: number,
  featherBottom: number,
) {
  const cw = canvas.width;
  const ch = canvas.height;
  const tw = tile.width;
  const th = tile.height;
  for (let y = 0; y < th; y++) {
    const cy = destY + y;
    if (cy < 0 || cy >= ch) continue;
    // Weight vertikal berdasarkan jarak ke tepi feathered.
    let wy = 1;
    if (featherTop > 0 && y < featherTop) wy = (y + 0.5) / featherTop;
    else if (featherBottom > 0 && y >= th - featherBottom)
      wy = (th - y - 0.5) / featherBottom;
    wy = Math.max(0, Math.min(1, wy));
    const wySmooth = wy * wy * (3 - 2 * wy);

    for (let x = 0; x < tw; x++) {
      const cx = destX + x;
      if (cx < 0 || cx >= cw) continue;
      let wx = 1;
      if (featherLeft > 0 && x < featherLeft) wx = (x + 0.5) / featherLeft;
      else if (featherRight > 0 && x >= tw - featherRight)
        wx = (tw - x - 0.5) / featherRight;
      wx = Math.max(0, Math.min(1, wx));
      const wxSmooth = wx * wx * (3 - 2 * wx);

      const w = wxSmooth * wySmooth;
      const ti = (y * tw + x) * 4;
      const ci = (cy * cw + cx) * 4;
      if (w >= 0.999) {
        canvas.data[ci] = tile.data[ti];
        canvas.data[ci + 1] = tile.data[ti + 1];
        canvas.data[ci + 2] = tile.data[ti + 2];
        canvas.data[ci + 3] = tile.data[ti + 3];
      } else {
        const inv = 1 - w;
        canvas.data[ci] = clampByte(canvas.data[ci] * inv + tile.data[ti] * w);
        canvas.data[ci + 1] = clampByte(canvas.data[ci + 1] * inv + tile.data[ti + 1] * w);
        canvas.data[ci + 2] = clampByte(canvas.data[ci + 2] * inv + tile.data[ti + 2] * w);
        canvas.data[ci + 3] = clampByte(canvas.data[ci + 3] * inv + tile.data[ti + 3] * w);
      }
    }
  }
}

async function tileEnhanceImage(
  image: RgbaImage,
  _apiKey: string,
  gridSize = 4,
): Promise<RgbaImage> {
  const W = image.width;
  const H = image.height;
  const N = gridSize;

  // Boundary cell disjoint (4x4).
  const xEdges: number[] = [];
  const yEdges: number[] = [];
  for (let i = 0; i <= N; i++) {
    xEdges.push(Math.round((W * i) / N));
    yEdges.push(Math.round((H * i) / N));
  }

  // Overlap 1% dari sisi terpanjang gambar (dibagi rata ke kedua sisi tile).
  const overlap = Math.max(2, Math.round(Math.max(W, H) * 0.01));

  type TileSpec = {
    gx: number;
    gy: number;
    // Crop region (dengan overlap di sisi internal).
    cropX: number;
    cropY: number;
    cropW: number;
    cropH: number;
    // Posisi paste pada canvas (= cropX/cropY).
    // Feather di sisi yang ada tetangganya saja (bukan di tepi gambar).
    featherLeft: number;
    featherTop: number;
    featherRight: number;
    featherBottom: number;
    name: string;
  };

  const specs: TileSpec[] = [];
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const x0 = xEdges[gx];
      const y0 = yEdges[gy];
      const x1 = xEdges[gx + 1];
      const y1 = yEdges[gy + 1];
      const hasLeft = gx > 0;
      const hasTop = gy > 0;
      const hasRight = gx < N - 1;
      const hasBottom = gy < N - 1;
      const cropX = hasLeft ? x0 - overlap : x0;
      const cropY = hasTop ? y0 - overlap : y0;
      const cropX1 = hasRight ? x1 + overlap : x1;
      const cropY1 = hasBottom ? y1 + overlap : y1;
      specs.push({
        gx,
        gy,
        cropX: Math.max(0, cropX),
        cropY: Math.max(0, cropY),
        cropW: Math.min(W, cropX1) - Math.max(0, cropX),
        cropH: Math.min(H, cropY1) - Math.max(0, cropY),
        featherLeft: hasLeft ? overlap : 0,
        featherTop: hasTop ? overlap : 0,
        featherRight: hasRight ? overlap : 0,
        featherBottom: hasBottom ? overlap : 0,
        name: `r${gy + 1}c${gx + 1}`,
      });
    }
  }

  // TAHAP 4: Setiap tile dipertajam dengan AI menggunakan PROMPT IDENTIK,
  // MODEL IDENTIK, dan PARAMETER IDENTIK (tanpa konteks unik per tile) — sehingga
  // metode & kualitas enhancement antar tile konsisten. Bila AI gagal/menyimpang
  // dari struktur asli, fallback ke filter sharpen deterministik yang juga
  // identik untuk semua tile. Tidak ada variasi parameter antar tile.
  const enhanced: RgbaImage[] = await Promise.all(
    specs.map(async (s) => {
      const tile = cropTile(image, s.cropX, s.cropY, s.cropW, s.cropH);
      const aiTile = await enhanceTileWithAI(tile, _apiKey);
      if (aiTile && preservesTileStructure(tile, aiTile)) return aiTile;
      return uniformTileEnhance(tile);
    }),
  );

  // Stitch dengan feathered blending hanya di area overlap 1%.
  const canvas: RgbaImage = { width: W, height: H, data: new Uint8Array(image.data) };
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    pasteTileFeathered(
      canvas,
      enhanced[i],
      s.cropX,
      s.cropY,
      s.featherLeft,
      s.featherTop,
      s.featherRight,
      s.featherBottom,
    );
  }

  return canvas;
}

function buildSystemPrompt(
  renderType: string,
  accuracy: number,
  consistency: number,
  userPrompt: string,
  hasReference: boolean,
) {
  const typePart = RENDER_TYPE_PROMPTS[renderType] ?? RENDER_TYPE_PROMPTS.exterior;

  const accuracyText =
    accuracy >= 9
      ? "WAJIB pertahankan SETIAP garis, proporsi, sudut, dan elemen arsitektural dari sketsa dengan presisi maksimal — jangan tambah/hilangkan bukaan, kolom, atau massa bangunan."
      : accuracy >= 7
      ? "Pertahankan komposisi, proporsi, dan elemen utama sketsa dengan akurat — boleh tambah detail material dan konteks tapi struktur harus identik."
      : accuracy >= 4
      ? "Gunakan sketsa sebagai panduan komposisi utama — boleh interpretasi kreatif pada detail."
      : "Gunakan sketsa sebagai inspirasi longgar — bebas berkreasi.";

  const consistencyText = hasReference
    ? consistency >= 9
      ? "WAJIB ikuti gaya, palet warna, mood, material, dan teknik render dari gambar referensi PERSIS."
      : consistency >= 7
      ? "Ikuti gaya, palet warna, dan mood gambar referensi dengan kuat."
      : consistency >= 4
      ? "Ambil inspirasi gaya dari gambar referensi."
      : "Referensi hanya inspirasi ringan."
    : "";

  return [
    typePart,
    accuracyText,
    consistencyText,
    `Permintaan tambahan dari arsitek: ${userPrompt}`,
    "Hasilkan SATU gambar render berkualitas tinggi. Jangan tampilkan teks, watermark, atau anotasi pada gambar.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const generateRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "ISI_API_KEY_DISINI") {
      return {
        ok: false as const,
        error: "GEMINI_API_KEY belum diisi. Buka src/config/apiConfig.ts dan masukkan API key Google AI Studio Anda.",
      };
    }

    // Insert pending row
    const { data: row, error: insertErr } = await supabase
      .from("renders")
      .insert({
        user_id: userId,
        prompt: data.prompt,
        render_type: data.renderType,
        accuracy: data.accuracy,
        consistency: data.consistency,
        status: "processing",
      })
      .select()
      .single();

    if (insertErr || !row) {
      return { ok: false as const, error: insertErr?.message ?? "DB error" };
    }

    const finalPrompt = buildSystemPrompt(
      data.renderType,
      data.accuracy,
      data.consistency,
      data.prompt,
      !!data.referenceBase64,
    );

    const seedSuffix =
      data.seed !== null && data.seed !== undefined
        ? `\n\nGunakan variation seed #${data.seed} sebagai anchor deterministik — render yang sama dengan seed sama harus mempertahankan komposisi, framing kamera, sudut pencahayaan, dan keputusan kreatif yang konsisten. Seed berbeda boleh menghasilkan variasi.`
        : "";

    const resolutionKey = data.resolution ?? "1k";
    const resSpec = RESOLUTION_SPECS[resolutionKey];
    const resolutionSuffix = `\n\nTARGET RESOLUSI: ${resSpec.label} pada sisi terpanjang. Hasilkan gambar setajam dan sedetail mungkin pada resolusi maksimal model. Jangan tampilkan watermark, logo, signature, tanda air, label "Gemini", "Google", "AI generated", atau marka apapun pada gambar. Output harus bersih sepenuhnya — hanya konten arsitektur.`;

    const promptWithSeed = finalPrompt + seedSuffix + resolutionSuffix;

    // Build Gemini parts (text + images) — direct Google AI Studio call.
    const geminiParts: GeminiPart[] = [{ text: promptWithSeed }];
    if (data.referenceBase64) {
      geminiParts.push({ text: "Gambar 1 di bawah adalah REFERENSI GAYA. Gambar 2 adalah SKETSA yang harus dirender:" });
      const refPart = dataUrlToInlinePart(data.referenceBase64);
      if (refPart) geminiParts.push(refPart);
    }
    const sketchPart = dataUrlToInlinePart(data.sketchBase64);
    if (!sketchPart) {
      await supabase
        .from("renders")
        .update({ status: "failed", error: "Sketsa bukan data URL valid" })
        .eq("id", row.id);
      return { ok: false as const, error: "Format sketsa tidak valid." };
    }
    geminiParts.push(sketchPart);

    try {
      const aiResult = await callGeminiImage(geminiParts);

      if (!aiResult.ok) {
        let msg = `Gemini error (${aiResult.status})`;
        if (aiResult.status === 429) msg = "Rate limit Gemini tercapai. Coba lagi sebentar.";
        if (aiResult.status === 403) msg = "API key Gemini ditolak (403). Periksa GEMINI_API_KEY di src/config/apiConfig.ts.";
        if (aiResult.status === 400) msg = "Permintaan ditolak Gemini (400).";
        await supabase
          .from("renders")
          .update({ status: "failed", error: msg + " — " + aiResult.error })
          .eq("id", row.id);
        return { ok: false as const, error: msg };
      }

      const imageDataUrl = aiResult.dataUrl;

      // ============================================================
      // TAHAP 1 SELESAI: gambar utuh sudah dihasilkan oleh AI di atas.
      // Kita TIDAK menjalankan cleanup-pass yang minta AI me-redraw seluruh
      // gambar (itu yang dulu sering mengubah komposisi & memunculkan elemen
      // aneh). Watermark sudah ditekan via instruksi prompt awal.
      // ============================================================

      // Decode hasil Tahap 1 menjadi pixel mentah
      const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) {
        await supabase
          .from("renders")
          .update({ status: "failed", error: "Invalid image format" })
          .eq("id", row.id);
        return { ok: false as const, error: "Format gambar tidak valid." };
      }
      let mime = match[1];
      let ext = mime.split("/")[1] ?? "png";
      let bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

      const decodedImage = decodeImage(bytes, mime);

      // ============================================================
      // TAHAP 2: Upscale piksel 2-5x ke target 2K/4K (bicubic, tanpa sharpen).
      // Untuk 1K: lewati upscale, gunakan gambar asli apa adanya.
      // ============================================================
      let processedImage = upscaleOnly(decodedImage, resolutionKey);

      // ============================================================
      // TAHAP 3 + 4 + 5: Pecah jadi 4x4 = 16 tile, perdetail tiap tile via AI
      // dengan instruksi KETAT (tidak boleh ubah bentuk/komposisi/warna),
      // lalu satukan kembali dengan paste presisi tanpa overlap (Tahap 5).
      // Hanya untuk 2K/4K — di 1K tidak perlu karena gambar masih asli AI.
      // ============================================================
      if (resolutionKey !== "1k") {
        try {
          processedImage = await tileEnhanceImage(processedImage, GEMINI_API_KEY, 4);
        } catch (tileErr) {
          console.error("Tile enhance failed, using upscaled fallback:", tileErr);
        }
      }

      if (resolutionKey === "1k") {
        mime = "image/png";
        ext = "png";
        bytes = new Uint8Array(encodePng({
          width: processedImage.width,
          height: processedImage.height,
          data: processedImage.data,
          channels: 4,
          depth: 8,
        }));
      } else {
        mime = "image/jpeg";
        ext = "jpg";
        bytes = new Uint8Array(
          jpeg.encode(
            { width: processedImage.width, height: processedImage.height, data: processedImage.data },
            resolutionKey === "8k" ? 96 : resolutionKey === "4k" ? 94 : 92,
          ).data,
        );
      }

      const path = `${userId}/${row.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("renders")
        .upload(path, bytes, { contentType: mime, upsert: true });
      if (upErr) {
        await supabase
          .from("renders")
          .update({ status: "failed", error: upErr.message })
          .eq("id", row.id);
        return { ok: false as const, error: upErr.message };
      }

      // Signed URL (1 year)
      const { data: signed } = await supabase.storage
        .from("renders")
        .createSignedUrl(path, 60 * 60 * 24 * 365);

      const resultUrl = signed?.signedUrl ?? null;

      await supabase
        .from("renders")
        .update({ status: "completed", result_url: resultUrl })
        .eq("id", row.id);

      return { ok: true as const, id: row.id, resultUrl };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      await supabase.from("renders").update({ status: "failed", error: msg }).eq("id", row.id);
      return { ok: false as const, error: msg };
    }
  });

export type RenderItem = {
  id: string;
  prompt: string;
  render_type: string;
  accuracy: number;
  consistency: number;
  result_url: string | null;
  status: string;
  created_at: string;
};

export const listMyRenders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("renders")
      .select("id, prompt, render_type, accuracy, consistency, result_url, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return { items: [] as RenderItem[], error: error.message };

    const refreshed: RenderItem[] = await Promise.all(
      (data ?? []).map(async (r) => {
        if (!r.result_url) return r as RenderItem;
        // Try both extensions (newer 2K/4K renders are jpg, older are png)
        for (const ext of ["jpg", "png"]) {
          const { data: s } = await supabase.storage
            .from("renders")
            .createSignedUrl(`${userId}/${r.id}.${ext}`, 60 * 60 * 24);
          if (s?.signedUrl) return { ...(r as RenderItem), result_url: s.signedUrl };
        }
        return r as RenderItem;
      }),
    );

    return { items: refreshed, error: null as string | null };
  });

export const deleteRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.storage
      .from("renders")
      .remove([`${userId}/${data.id}.png`, `${userId}/${data.id}.jpg`]);
    const { error } = await supabase.from("renders").delete().eq("id", data.id);
    return { ok: !error, error: error?.message ?? null };
  });
