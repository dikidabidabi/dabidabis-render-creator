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
});

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

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "text", text: finalPrompt },
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
          model: "google/gemini-2.5-flash-image",
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

      // Decode and upload to storage
      const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) {
        await supabase
          .from("renders")
          .update({ status: "failed", error: "Invalid image format" })
          .eq("id", row.id);
        return { ok: false as const, error: "Format gambar tidak valid." };
      }
      const mime = match[1];
      const ext = mime.split("/")[1] ?? "png";
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

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
    if (error) return { items: [] as Array<Record<string, unknown>>, error: error.message };

    // Refresh signed URLs for any items pointing to storage
    const refreshed = await Promise.all(
      (data ?? []).map(async (r) => {
        if (!r.result_url) return r;
        const path = `${userId}/${r.id}.png`;
        const { data: s } = await supabase.storage
          .from("renders")
          .createSignedUrl(path, 60 * 60 * 24);
        return { ...r, result_url: s?.signedUrl ?? r.result_url };
      }),
    );

    return { items: refreshed, error: null };
  });

export const deleteRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.storage.from("renders").remove([`${userId}/${data.id}.png`]);
    const { error } = await supabase.from("renders").delete().eq("id", data.id);
    return { ok: !error, error: error?.message ?? null };
  });
