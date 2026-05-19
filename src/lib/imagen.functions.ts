import { createServerFn } from "@tanstack/react-start";

export const generateImagen = createServerFn({ method: "POST" })
  .inputValidator((input: { apiKey: string; prompt: string }) => {
    if (!input?.apiKey || typeof input.apiKey !== "string") throw new Error("apiKey wajib diisi");
    if (!input?.prompt || typeof input.prompt !== "string") throw new Error("prompt wajib diisi");
    if (input.apiKey.length < 20 || input.apiKey.length > 200) throw new Error("apiKey tidak valid");
    if (input.prompt.length > 4000) throw new Error("prompt terlalu panjang");
    return input;
  })
  .handler(async ({ data }) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:generateImages?key=${encodeURIComponent(
      data.apiKey,
    )}`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: data.prompt,
        numberOfImages: 1,
        aspectRatio: "1:1",
        outputMimeType: "image/jpeg",
      }),
    });

    const text = await resp.text();
    if (!resp.ok) {
      let msg = `Google API error (${resp.status})`;
      if (resp.status === 400) msg = "Request ditolak. Cek API Key & akses Imagen 3.";
      if (resp.status === 401 || resp.status === 403)
        msg = "API Key tidak valid atau belum punya akses Imagen 3 (perlu billing aktif di Google Cloud).";
      if (resp.status === 404) msg = "Model tidak ditemukan. Pastikan akses Imagen 3 aktif.";
      if (resp.status === 429) msg = "Quota habis / rate limit. Coba lagi nanti.";
      throw new Error(`${msg} — ${text.slice(0, 240)}`);
    }

    const json = JSON.parse(text);
    const imgB64: string | undefined = json?.generatedImages?.[0]?.image?.imageBytes;
    if (!imgB64) throw new Error("API tidak mengembalikan gambar.");
    return { imageBase64: imgB64, mimeType: "image/jpeg" as const };
  });
