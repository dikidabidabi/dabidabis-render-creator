const KEY = "dabidabis_google_api_key";

export function getApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

export function setApiKey(value: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, value.trim());
}

export function clearApiKey() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

const RENDER_TYPE_PROMPTS: Record<string, string> = {
  exterior:
    "Render sebagai foto eksterior arsitektur fotorealistis profesional. Pencahayaan natural golden hour, material realistis (beton, kayu, kaca, baja), refleksi akurat, langit dramatis, vegetasi sekitar menyatu, depth of field halus. Kualitas portfolio arsitek kelas atas.",
  interior:
    "Render sebagai foto interior fotorealistis berkualitas majalah. Pencahayaan ambient lembut, furniture kontemporer, tekstur material akurat (kayu, marmer, kain, logam), highlight dan bayangan natural, depth of field sinematik.",
  night:
    "Render sebagai night shot arsitektur dramatis. Pencahayaan buatan dari interior memancar hangat, lampu landscape strategis, langit malam biru tua, refleksi cahaya pada kaca dan permukaan basah, mood sinematik high-end.",
  watercolor:
    "Render sebagai ilustrasi cat air arsitektur artistik. Wash warna lembut, garis kontur tinta tipis, tekstur kertas terlihat, proporsi terjaga, palet warna tenang dan elegan.",
};

export function buildImagenPrompt(opts: {
  renderType: string;
  accuracy: number;
  consistency: number;
  userPrompt: string;
  hasReference: boolean;
}) {
  const type = RENDER_TYPE_PROMPTS[opts.renderType] ?? RENDER_TYPE_PROMPTS.exterior;
  const acc =
    opts.accuracy >= 8
      ? "Pertahankan komposisi dan proporsi arsitektural dengan presisi tinggi."
      : opts.accuracy >= 5
      ? "Ikuti komposisi utama dengan akurat, boleh tambah detail material."
      : "Interpretasi bebas pada komposisi.";
  const cons = opts.hasReference
    ? opts.consistency >= 8
      ? "Ikuti gaya, palet warna, dan mood referensi dengan ketat."
      : opts.consistency >= 5
      ? "Ambil inspirasi gaya dari referensi."
      : "Referensi inspirasi ringan."
    : "";
  return [type, acc, cons, `Detail tambahan: ${opts.userPrompt}`, "Tanpa teks, watermark, atau anotasi."]
    .filter(Boolean)
    .join(" ");
}
