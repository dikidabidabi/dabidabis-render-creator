import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  imageBase64: z.string().min(20),
  motion: z.enum(["zoom-in", "zoom-out", "pan-lr", "pan-rl", "pan-tb", "pan-bt", "diagonal", "orbit"]),
});

const LayerSchema = z.object({
  imageBase64: z.string().min(20),
});

async function callGeminiImage(apiKey: string, prompt: string, imageBase64: string) {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageBase64 } },
          ],
        },
      ],
      modalities: ["image", "text"],
    }),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`AI ${response.status}: ${txt.slice(0, 200)}`);
  }
  const json = await response.json();
  const url = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url || typeof url !== "string") {
    throw new Error("AI tidak mengembalikan gambar");
  }
  return url;
}

/**
 * Generate two separated depth layers for pseudo-3D parallax:
 *   - foreground: subjek utama (bangunan/objek) dengan latar dihapus → transparan
 *   - background: lingkungan/langit diperluas, subjek utama dihapus / di-inpaint
 * Client renderer akan menganimasikan kedua layer dengan kecepatan & skala berbeda
 * sehingga sudut bangunan terasa berubah mengikuti gerakan kamera.
 */
export const generateDepthLayers = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ imageBase64: z.string().min(20) }).parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "AI gateway tidak tersedia" };
    }

    try {
      const [foreground, background] = await Promise.all([
        callGeminiImage(
          apiKey,
          "Isolasi subjek utama (bangunan/objek arsitektural utama) dari gambar ini. Hapus seluruh latar belakang sehingga menjadi PNG dengan latar transparan / hitam pekat (#000000). PERTAHANKAN bentuk, sudut, warna, dan material subjek utama PERSIS sama. Output PNG dengan alpha channel jika memungkinkan.",
          data.imageBase64,
        ).catch((e) => {
          console.error("foreground gen failed", e);
          return null;
        }),
        callGeminiImage(
          apiKey,
          "Hapus subjek utama (bangunan/objek arsitektural utama) dari gambar ini dan isi area kosongnya secara natural dengan lingkungan sekitar (langit, jalanan, vegetasi, bangunan jauh). Perluas dan perdetail latar belakang. PERTAHANKAN gaya, warna, lighting, dan suasana yang sama. Output gambar lengkap tanpa subjek utama.",
          data.imageBase64,
        ).catch((e) => {
          console.error("background gen failed", e);
          return null;
        }),
      ]);

      if (!foreground && !background) {
        return { ok: false as const, error: "AI gagal menghasilkan layer depth" };
      }

      return {
        ok: true as const,
        foregroundBase64: foreground,
        backgroundBase64: background,
      };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Unknown error" };
    }
  });

// Backward-compat: keep old export so studio.tsx etc. still build if referenced.
export const generateCinematicKeyframe = createServerFn({ method: "POST" })
  .inputValidator((d) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false as const, error: "AI gateway tidak tersedia" };
    try {
      const url = await callGeminiImage(
        apiKey,
        "Buat versi sinematik dengan sudut kamera sedikit bergeser (~10°) dari gambar ini. PERTAHANKAN gaya, warna, material, dan komposisi inti.",
        data.imageBase64,
      );
      return { ok: true as const, imageBase64: url };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Unknown error" };
    }
  });
