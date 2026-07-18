import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ALLOWED_MODELS = [
  "google/gemini-2.5-flash-image",
  "google/gemini-3.1-flash-image",
  "google/gemini-3-pro-image",
] as const;

const InputSchema = z.object({
  tileBase64: z.string().min(10),
  prompt: z.string().min(1).max(2000),
  model: z.enum(ALLOWED_MODELS).optional(),
});

/**
 * Lightweight tile-upscale endpoint. Returns the AI-enhanced tile as a
 * data URL without persisting to the renders table. Designed for the
 * client-side tiled upscale pipeline (many small sequential calls).
 * Surfaces 429 explicitly so the client can back off.
 */
export const upscaleTile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) {
      return { ok: false as const, status: 500, error: "AI service belum dikonfigurasi." };
    }
    const model = data.model ?? "google/gemini-2.5-flash-image";

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": LOVABLE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: data.prompt },
              { type: "image_url", image_url: { url: data.tileBase64 } },
            ],
          },
        ],
      }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text();
      return {
        ok: false as const,
        status: aiResp.status,
        error: `AI error ${aiResp.status}: ${text.slice(0, 200)}`,
      };
    }

    const json = await aiResp.json();
    const imageDataUrl: string | undefined =
      json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageDataUrl) {
      return { ok: false as const, status: 502, error: "AI tidak menghasilkan gambar." };
    }
    return { ok: true as const, image: imageDataUrl, model };
  });
