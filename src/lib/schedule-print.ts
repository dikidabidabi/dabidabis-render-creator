/** Lebar area cetak A4 lanskap (297 mm − margin 2×10 mm) pada 96 px/inci. */
export const PRINTABLE_WIDTH_PX = Math.round(((297 - 20) / 25.4) * 96); // 1046

/** Skala agar konten muat sisi kiri-kanan kertas; tidak pernah membesar melebihi 100%. */
export function printZoom(contentWidth: number, printableWidth = PRINTABLE_WIDTH_PX) {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return 1;
  return Math.min(1, printableWidth / contentWidth);
}

export type SchedulePrintMode = "schedule" | "scurve";

/** Cut only at complete task boundaries; the final slice includes the time axes. */
export function curvePrintSlices(rowCount: number, rowHeight: number, plotHeight: number, axisHeight: number, firstCapacity: number, pageCapacity: number) {
  if (!rowCount) return [{ from: 0, to: 0, offset: 0, height: plotHeight + axisHeight, axes: true }];
  const slices: { from: number; to: number; offset: number; height: number; axes: boolean }[] = [];
  let from = 0;
  while (from < rowCount) {
    const capacity = slices.length ? pageCapacity : firstCapacity;
    const remaining = rowCount - from;
    const axes = remaining * rowHeight + axisHeight <= capacity;
    const count = axes ? remaining : Math.min(remaining, Math.max(1, Math.floor((capacity - (remaining * rowHeight <= capacity ? axisHeight : 0)) / rowHeight)));
    const to = from + count;
    slices.push({ from, to, offset: from * rowHeight, height: count * rowHeight + (to === rowCount ? axisHeight : 0), axes: to === rowCount });
    from = to;
  }
  return slices;
}

/** Each paper fragment owns both its task labels and the same cropped SVG rows. */
function prepareCurvePrint(element: HTMLElement, zoom: number) {
  const chart = element.querySelector<HTMLElement>(".schedule-curve-chart");
  const labels = chart?.querySelector<HTMLElement>(".schedule-curve-labels");
  const svg = chart?.querySelector<SVGSVGElement>(":scope > svg");
  const rows = labels?.firstElementChild;
  if (!chart || !labels || !svg || !(rows instanceof HTMLElement)) return () => {};
  const rowCount = rows.children.length;
  const plotHeight = parseFloat(rows.style.height);
  const svgHeight = Number(svg.getAttribute("height"));
  const svgWidth = Number(svg.getAttribute("width"));
  const paperHeight = ((210 - 20) / 25.4) * 96 / zoom;
  const headerHeight = (chart.getBoundingClientRect().top - element.getBoundingClientRect().top) / zoom;
  const slices = curvePrintSlices(rowCount, rowCount ? plotHeight / rowCount : 0, plotHeight, svgHeight - plotHeight, paperHeight - headerHeight - 24, paperHeight - 24);
  const output = document.createElement("div");
  output.className = "schedule-curve-print";
  for (const slice of slices) {
    const page = document.createElement("div");
    page.className = "schedule-curve-print-page";
    const names = labels.cloneNode(true) as HTMLElement;
    const nameRows = names.firstElementChild;
    if (!(nameRows instanceof HTMLElement)) continue;
    [...nameRows.children].forEach((row, index) => { if (index < slice.from || index >= slice.to) row.remove(); });
    nameRows.style.height = `${slice.height - (slice.axes ? svgHeight - plotHeight : 0)}px`;
    if (!slice.axes) [...names.children].slice(1).forEach((axis) => axis.remove());
    const graphic = svg.cloneNode(true) as SVGSVGElement;
    graphic.setAttribute("viewBox", `0 ${slice.offset} ${svgWidth} ${slice.height}`);
    graphic.setAttribute("height", String(slice.height));
    graphic.style.overflow = "hidden";
    page.append(names, graphic);
    output.append(page);
  }
  chart.after(output);
  return () => output.remove();
}

/**
 * Mencetak satu bagian halaman Jadwal sebagai PDF lanskap via dialog cetak peramban.
 * Menandai <html> dengan kelas mode cetak, mengecilkan konten agar muat lebar kertas,
 * lalu memanggil window.print(); baris panjang mengalir ke halaman berikutnya.
 */
export function printScheduleSection(element: HTMLElement | null, mode: SchedulePrintMode) {
  if (!element) return;
  const root = document.documentElement;
  const chart = element.querySelector<HTMLElement>(".schedule-curve-chart");
  const contentWidth = Math.max(element.scrollWidth, chart?.scrollWidth ?? 0);
  root.classList.add(mode === "schedule" ? "print-schedule" : "print-scurve");
  const zoom = printZoom(contentWidth);
  element.style.zoom = String(zoom);
  const removeCurvePrint = mode === "scurve" ? prepareCurvePrint(element, zoom) : () => {};
  const cleanup = () => {
    removeCurvePrint();
    root.classList.remove("print-schedule", "print-scurve");
    element.style.zoom = "";
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
