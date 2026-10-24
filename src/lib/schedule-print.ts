/** Lebar area cetak A4 lanskap (297 mm − margin 2×10 mm) pada 96 px/inci. */
export const PRINTABLE_WIDTH_PX = Math.round(((297 - 20) / 25.4) * 96); // 1046

/** Skala agar konten muat sisi kiri-kanan kertas; tidak pernah membesar melebihi 100%. */
export function printZoom(contentWidth: number, printableWidth = PRINTABLE_WIDTH_PX) {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return 1;
  return Math.min(1, printableWidth / contentWidth);
}

export type SchedulePrintMode = "schedule" | "scurve";

/**
 * Mencetak satu bagian halaman Jadwal sebagai PDF lanskap via dialog cetak peramban.
 * Menandai <html> dengan kelas mode cetak, mengecilkan konten agar muat lebar kertas,
 * lalu memanggil window.print(); baris panjang mengalir ke halaman berikutnya.
 */
export function printScheduleSection(element: HTMLElement | null, mode: SchedulePrintMode) {
  if (!element) return;
  const root = document.documentElement;
  const svg = element.querySelector("svg");
  const contentWidth = Math.max(element.scrollWidth, svg ? Number(svg.getAttribute("width")) + 240 : 0);
  root.classList.add(mode === "schedule" ? "print-schedule" : "print-scurve");
  element.style.zoom = String(printZoom(contentWidth));
  const cleanup = () => {
    root.classList.remove("print-schedule", "print-scurve");
    element.style.zoom = "";
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
