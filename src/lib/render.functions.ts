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

      // Pass 3: AI super-resolution via Gemini itself.
      // The Cloudflare Worker runtime blocks dynamic WASM compilation, so
      // jSquash/sharp/canvas are all unavailable. Instead we use Gemini as
      // its own upscaler: re-feed the cleaned image with an explicit
      // "increase pixel detail / sharpen / add micro-texture" prompt.
      // 2K = 1 enhance pass, 4K = 2 progressive enhance passes.
      const enhancePasses = resolutionKey === "4k" ? 2 : resolutionKey === "2k" ? 1 : 0;
      let currentDataUrl = cleanedDataUrl;

      for (let i = 0; i < enhancePasses; i++) {
        const targetLabel = resSpec.label;
        const passLabel = enhancePasses > 1 ? ` (pass ${i + 1}/${enhancePasses})` : "";
        const enhancePrompt = `TUGAS: Tingkatkan resolusi efektif dan ketajaman gambar arsitektur ini ke kualitas ${targetLabel}${passLabel}.

YANG HARUS DILAKUKAN:
- Tambahkan detail mikro yang realistis pada material: serat kayu, pori beton, refleksi pada kaca, tekstur batu, daun vegetasi, butir aspal, jahitan logam.
- Pertajam tepi arsitektural — garis kusen, mullion, profil kolom, sambungan panel — sehingga terlihat crisp pada layar besar.
- Naikkan local contrast dan micro-contrast secara natural (seperti hasil kamera medium-format).
- Bersihkan noise/blur halus, recover detail di area gelap dan highlight tanpa over-expose.
- Pertahankan depth of field, bokeh, dan atmospheric haze yang sudah ada.

ATURAN KETAT:
- JANGAN ubah komposisi, framing, sudut kamera, proporsi bangunan, palet warna, atau mood pencahayaan.
- JANGAN tambah/hilangkan bukaan, kolom, vegetasi, atau elemen arsitektural.
- JANGAN tambahkan watermark, logo, teks, signature, atau marka apapun. Output harus 100% bersih.
- Hasil harus terlihat seperti versi resolusi-tinggi dari gambar yang sama, bukan render baru.`;

        try {
          const enhResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                    { type: "text", text: enhancePrompt },
                    { type: "image_url", image_url: { url: currentDataUrl } },
                  ],
                },
              ],
              modalities: ["image", "text"],
            }),
          });
          if (enhResp.ok) {
            const enhJson = await enhResp.json();
            const enhUrl: string | undefined =
              enhJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
            if (enhUrl) currentDataUrl = enhUrl;
          } else {
            console.error("Enhance pass failed:", enhResp.status, await enhResp.text());
          }
        } catch (e) {
          console.error("Enhance pass error:", e);
        }
      }

      // Re-decode the final (possibly enhanced) image
      if (enhancePasses > 0 && currentDataUrl !== cleanedDataUrl) {
        const m2 = currentDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (m2) {
          mime = m2[1];
          ext = mime.split("/")[1] ?? "png";
          bytes = Uint8Array.from(atob(m2[2]), (c) => c.charCodeAt(0));
        }
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
