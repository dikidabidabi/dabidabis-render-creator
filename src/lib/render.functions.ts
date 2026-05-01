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
  resolution: z.enum(["1k", "2k", "4k"]).default("1k").optional(),
});

const RESOLUTION_SPECS: Record<string, { label: string; longEdge: number }> = {
  "1k": { label: "1K (1024px)", longEdge: 1024 },
  "2k": { label: "2K (2048px)", longEdge: 2048 },
  "4k": { label: "4K (3840px)", longEdge: 3840 },
};

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

function upscaleAndSharpen(image: RgbaImage, resolutionKey: string): RgbaImage {
  if (resolutionKey === "1k") return sharpenImage(touchupBottomRightLogo(image), 0.2);

  const targetLongEdge = RESOLUTION_SPECS[resolutionKey]?.longEdge ?? RESOLUTION_SPECS["1k"].longEdge;
  const currentLongEdge = Math.max(image.width, image.height);
  const scale = Math.min(5, Math.max(2, targetLongEdge / currentLongEdge));
  const upscaled = resizeBicubic(touchupBottomRightLogo(image), scale);
  const sharpened = sharpenImage(upscaled, resolutionKey === "4k" ? 0.62 : 0.48);
  return touchupBottomRightLogo(sharpened);
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
  const tw = tile.width;
  const th = tile.height;
  for (let y = 0; y < th; y++) {
    let wy = 1;
    if (featherTop > 0 && y < featherTop) wy = (y + 0.5) / featherTop;
    if (featherBottom > 0 && y >= th - featherBottom) {
      const d = (th - y - 0.5) / featherBottom;
      wy = Math.min(wy, d);
    }
    for (let x = 0; x < tw; x++) {
      let wx = 1;
      if (featherLeft > 0 && x < featherLeft) wx = (x + 0.5) / featherLeft;
      if (featherRight > 0 && x >= tw - featherRight) {
        const d = (tw - x - 0.5) / featherRight;
        wx = Math.min(wx, d);
      }
      let w = Math.max(0, Math.min(1, wx * wy));
      // smoothstep
      w = w * w * (3 - 2 * w);
      if (w <= 0) continue;
      const ti = (y * tw + x) * 4;
      const ci = ((destY + y) * cw + (destX + x)) * 4;
      const inv = 1 - w;
      canvas.data[ci] = clampByte(canvas.data[ci] * inv + tile.data[ti] * w);
      canvas.data[ci + 1] = clampByte(canvas.data[ci + 1] * inv + tile.data[ti + 1] * w);
      canvas.data[ci + 2] = clampByte(canvas.data[ci + 2] * inv + tile.data[ti + 2] * w);
      canvas.data[ci + 3] = 255;
    }
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

async function enhanceTileWithAI(
  tile: RgbaImage,
  apiKey: string,
  contextHint: string,
): Promise<RgbaImage | null> {
  const inputUrl = rgbaToJpegDataUrl(tile, 92);
  const prompt = `Tugas: Tingkatkan ketajaman dan detail mikro pada gambar render arsitektur ini (ini adalah SATU KUADRAN dari gambar yang lebih besar — ${contextHint}).

ATURAN KETAT:
- JANGAN ubah komposisi, framing, warna dominan, pencahayaan, sudut, atau elemen apapun.
- JANGAN tambah/hilangkan objek. JANGAN crop. JANGAN re-style.
- Output HARUS memiliki dimensi dan framing IDENTIK dengan input — hanya lebih tajam dan detail.
- Tambahkan detail mikro realistis: tekstur material (urat kayu, pori beton, butiran batu, refleksi kaca, jahitan kain), tepi tajam, kontras lokal natural.
- JANGAN tambahkan watermark, logo, teks, signature apapun.
- Hasilkan gambar bersih sepenuhnya, kualitas fotografi profesional.`;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: inputUrl } },
            ],
          },
        ],
        modalities: ["image", "text"],
      }),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const url: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) return null;
    const decoded = dataUrlToRgba(url);
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

async function tileEnhanceImage(image: RgbaImage, apiKey: string): Promise<RgbaImage> {
  const W = image.width;
  const H = image.height;
  // 2x2 grid with ~12% overlap on inner edges for seamless blending
  const overlapX = Math.round(W * 0.12);
  const overlapY = Math.round(H * 0.12);
  const halfW = Math.ceil(W / 2);
  const halfH = Math.ceil(H / 2);

  const tilesSpec = [
    { name: "kiri-atas",   gx: 0, gy: 0 },
    { name: "kanan-atas",  gx: 1, gy: 0 },
    { name: "kiri-bawah",  gx: 0, gy: 1 },
    { name: "kanan-bawah", gx: 1, gy: 1 },
  ];

  const cropped = tilesSpec.map((t) => {
    const x0 = t.gx === 0 ? 0 : Math.max(0, halfW - overlapX);
    const y0 = t.gy === 0 ? 0 : Math.max(0, halfH - overlapY);
    const x1 = t.gx === 0 ? Math.min(W, halfW + overlapX) : W;
    const y1 = t.gy === 0 ? Math.min(H, halfH + overlapY) : H;
    return { ...t, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });

  // Enhance all 4 tiles in parallel
  const enhanced = await Promise.all(
    cropped.map((c) =>
      enhanceTileWithAI(cropTile(image, c.x, c.y, c.w, c.h), apiKey, `kuadran ${c.name}`),
    ),
  );

  // Stitch onto a fresh canvas (start from a sharpened copy as fallback)
  const canvas: RgbaImage = { width: W, height: H, data: new Uint8Array(image.data) };

  for (let i = 0; i < cropped.length; i++) {
    const tile = enhanced[i];
    if (!tile) continue;
    const c = cropped[i];
    const featherLeft = c.gx === 1 ? overlapX : 0;
    const featherTop = c.gy === 1 ? overlapY : 0;
    const featherRight = c.gx === 0 ? overlapX : 0;
    const featherBottom = c.gy === 0 ? overlapY : 0;
    pasteTileFeathered(canvas, tile, c.x, c.y, featherLeft, featherTop, featherRight, featherBottom);
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
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) {
      return { ok: false as const, error: "AI service belum dikonfigurasi." };
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

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "text", text: promptWithSeed },
      { type: "image_url", image_url: { url: data.sketchBase64 } },
    ];
    if (data.referenceBase64) {
      userContent.splice(1, 0, {
        type: "text",
        text: "Gambar 1 di bawah adalah REFERENSI GAYA. Gambar 2 adalah SKETSA yang harus dirender:",
      });
      userContent.push({ type: "image_url", image_url: { url: data.referenceBase64 } });
    }

    try {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-image-preview",
          messages: [{ role: "user", content: userContent }],
          modalities: ["image", "text"],
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        let msg = `AI error (${aiResp.status})`;
        if (aiResp.status === 429) msg = "Rate limit tercapai. Coba lagi sebentar.";
        if (aiResp.status === 402) msg = "Kredit AI habis. Tambahkan kredit di workspace.";
        await supabase
          .from("renders")
          .update({ status: "failed", error: msg + " — " + errText.slice(0, 200) })
          .eq("id", row.id);
        return { ok: false as const, error: msg };
      }

      const aiJson = await aiResp.json();
      const imageDataUrl: string | undefined =
        aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;

      if (!imageDataUrl) {
        await supabase
          .from("renders")
          .update({ status: "failed", error: "Tidak ada gambar dihasilkan" })
          .eq("id", row.id);
        return { ok: false as const, error: "AI tidak menghasilkan gambar." };
      }

      // Pass 2: ALWAYS run a cleanup pass to remove Gemini/Google watermark.
      // The watermark from gemini-3.1-flash-image-preview is consistently in the
      // bottom-right corner — we instruct the model to inpaint that region only.
      let cleanedDataUrl = imageDataUrl;
      try {
        const cleanupPrompt = `TUGAS UTAMA: Hapus total watermark / logo "Gemini" / logo "Google" / tanda "AI" yang berada di pojok kanan bawah gambar ini. Gantikan area watermark dengan kelanjutan visual yang natural dari konten arsitektural di sekitarnya (inpainting) — sehingga tidak terlihat ada watermark sama sekali.

ATURAN KETAT:
- JANGAN ubah komposisi, framing, warna, mood, pencahayaan, sudut kamera, atau elemen arsitektural manapun.
- JANGAN tambah objek baru, JANGAN crop, JANGAN re-style.
- HASIL HARUS identik dengan gambar input KECUALI watermark sudah hilang sempurna.
- Output 100% bersih: tanpa logo, tanpa teks, tanpa signature, tanpa watermark apapun.
- Pertahankan kualitas, ketajaman, dan resolusi maksimal.`;
        const cleanResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3.1-flash-image-preview",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: cleanupPrompt },
                  { type: "image_url", image_url: { url: imageDataUrl } },
                ],
              },
            ],
            modalities: ["image", "text"],
          }),
        });
        if (cleanResp.ok) {
          const cleanJson = await cleanResp.json();
          const cleanUrl: string | undefined =
            cleanJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
          if (cleanUrl) cleanedDataUrl = cleanUrl;
        }
      } catch {
        // fallback: keep original
      }

      // Decode the (cleaned) image into raw bytes
      const match = cleanedDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
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

      // Pass 3: real internal pixel upscale + sharpening.
      // Gemini's image endpoint often returns ~1K pixels even when prompted for 2K/4K,
      // so we physically resize the cleaned image 2–5x toward the requested target,
      // then apply an unsharp-mask style detail pass and a final logo touchup.
      const decodedImage = decodeImage(bytes, mime);
      const processedImage = upscaleAndSharpen(decodedImage, resolutionKey);

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
            resolutionKey === "4k" ? 94 : 92,
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
