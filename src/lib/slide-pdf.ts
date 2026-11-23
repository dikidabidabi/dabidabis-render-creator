/**
 * Ukuran kertas & resolusi untuk unduhan PDF per slide (A1/A2 lanskap).
 * Rasio slide (1414×1000) = rasio seri-A, sehingga gambar memenuhi halaman tanpa terpotong.
 */
export type SlidePdfPaper = "A1" | "A2";

export const SLIDE_PDF_PAPERS: Record<SlidePdfPaper, { widthMm: number; heightMm: number; dpi: number }> = {
  A1: { widthMm: 841, heightMm: 594, dpi: 150 },
  A2: { widthMm: 594, heightMm: 420, dpi: 200 },
};

/** Batas aman piksel kanvas (Safari iOS ≈ 16,7 juta piksel). */
export const SLIDE_PDF_MAX_PIXELS = 16_000_000;

/** Skala html2canvas & ukuran raster akhir untuk slide berukuran slideW×slideH px. */
export function slidePdfRaster(paper: SlidePdfPaper, slideW: number, slideH: number) {
  const spec = SLIDE_PDF_PAPERS[paper];
  const targetW = (spec.widthMm / 25.4) * spec.dpi;
  let scale = targetW / slideW;
  const pixels = slideW * scale * slideH * scale;
  if (pixels > SLIDE_PDF_MAX_PIXELS) scale *= Math.sqrt(SLIDE_PDF_MAX_PIXELS / pixels);
  const width = Math.round(slideW * scale);
  const height = Math.round(slideH * scale);
  const effectiveDpi = Math.round(width / (spec.widthMm / 25.4));
  return { scale, width, height, effectiveDpi, widthMm: spec.widthMm, heightMm: spec.heightMm };
}

export function slidePdfFileName(projectTitle: string, slideNumber: number, slideTitle: string, paper: SlidePdfPaper) {
  const clean = (s: string) => s.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return `${clean(projectTitle) || "presentasi"}_slide-${slideNumber}_${clean(slideTitle) || "slide"}_${paper}.pdf`;
}
