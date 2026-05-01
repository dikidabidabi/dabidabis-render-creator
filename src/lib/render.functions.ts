import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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

      // Pass 3: REAL pixel upscale via WASM (jSquash) for 2K/4K.
      // The Gemini image model outputs ~1024px on the long edge regardless of
      // prompt instructions, so we must resample on the server.
      if (resolutionKey === "2k" || resolutionKey === "4k") {
        try {
          const [{ default: decodePng }, { default: encodePng }, { default: decodeJpeg }, { default: encodeJpeg }, { default: resize }] =
            await Promise.all([
              import("@jsquash/png/decode"),
              import("@jsquash/png/encode"),
              import("@jsquash/jpeg/decode"),
              import("@jsquash/jpeg/encode"),
              import("@jsquash/resize"),
            ]);

          const isPng = mime === "image/png";
          const imageData = isPng
            ? await decodePng(bytes.buffer as ArrayBuffer)
            : await decodeJpeg(bytes.buffer as ArrayBuffer);

          const longEdge = Math.max(imageData.width, imageData.height);
          const scale = resSpec.longEdge / longEdge;
          if (scale > 1.01) {
            const targetW = Math.round(imageData.width * scale);
            const targetH = Math.round(imageData.height * scale);
            const upscaled = await resize(imageData, {
              width: targetW,
              height: targetH,
              method: "lanczos3",
              fitMethod: "stretch",
              premultiply: true,
              linearRGB: true,
            });
            // Re-encode as JPEG quality 95 (PNG at 4K would be huge)
            const jpegBuf = await encodeJpeg(upscaled, { quality: 95 });
            bytes = new Uint8Array(jpegBuf);
            mime = "image/jpeg";
            ext = "jpg";
          } else {
            // Already at or above target — just re-encode original
            if (isPng) {
              const buf = await encodePng(imageData);
              bytes = new Uint8Array(buf);
            }
          }
        } catch (e) {
          console.error("Upscale pass failed, using cleaned original:", e);
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
