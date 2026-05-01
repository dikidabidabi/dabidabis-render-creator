import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  imageBase64: z.string().min(20),
  motion: z.enum(["zoom-in", "zoom-out", "pan-lr", "pan-rl", "pan-tb", "pan-bt", "diagonal", "orbit"]),
});

/**
 * Optional AI cinematic enhancement: generates a "destination" keyframe
 * (slightly altered perspective / parallax-shifted) using Lovable AI image edit.
 * The client blends start & end frames during the camera motion to create
 * a parallax/cinematic feel without needing a real video model.
 */
export const generateCinematicKeyframe = createServerFn({ method: "POST" })
  .inputValidator((d) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "AI gateway tidak tersedia" };
    }

    const motionPrompt: Record<string, string> = {
      "zoom-in":
        "Buat versi close-up sinematik dari gambar ini: kamera mendekat ~20%, fokus pada detail tengah, depth of field lebih dangkal, bokeh halus di tepi. PERTAHANKAN gaya, warna, material, dan komposisi inti — hanya ubah perspektif/jarak.",
      "zoom-out":
        "Buat versi wide-shot sinematik dari gambar ini: kamera menjauh ~15%, perlihatkan lebih banyak konteks lingkungan di sekitar tepi, tetap pertahankan subjek utama di tengah. PERTAHANKAN gaya, warna, dan material.",
      "pan-lr":
        "Geser sudut pandang kamera sedikit ke kanan (~10%), tunjukkan sisi kanan subjek dengan parallax halus. PERTAHANKAN gaya, warna, material, dan suasana.",
      "pan-rl":
        "Geser sudut pandang kamera sedikit ke kiri (~10%), tunjukkan sisi kiri subjek dengan parallax halus. PERTAHANKAN gaya, warna, material, dan suasana.",
      "pan-tb":
        "Geser sudut pandang kamera sedikit ke bawah (~10%), perlihatkan elemen bawah/foreground lebih jelas. PERTAHANKAN gaya dan warna.",
      "pan-bt":
        "Geser sudut pandang kamera sedikit ke atas (~10%), perlihatkan langit/atap lebih jelas. PERTAHANKAN gaya dan warna.",
      diagonal:
        "Geser kamera secara diagonal (kanan-atas) ~10% dengan parallax sinematik halus. PERTAHANKAN gaya, warna, dan material.",
      orbit:
        "Buat versi dengan sudut kamera bergeser ~8 derajat ke samping (efek orbit halus). PERTAHANKAN subjek tetap di pusat dengan gaya, warna, dan material yang sama.",
    };

    try {
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
                { type: "text", text: motionPrompt[data.motion] },
                { type: "image_url", image_url: { url: data.imageBase64 } },
              ],
            },
          ],
          modalities: ["image", "text"],
        }),
      });

      if (!response.ok) {
        const txt = await response.text();
        return { ok: false as const, error: `AI error ${response.status}: ${txt.slice(0, 200)}` };
      }

      const json = await response.json();
      const url = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!url || typeof url !== "string") {
        return { ok: false as const, error: "AI tidak mengembalikan gambar" };
      }
      return { ok: true as const, imageBase64: url };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Unknown error" };
    }
  });
