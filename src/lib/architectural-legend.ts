export type ArchitecturalLegendPosition = "right" | "bottom";
/** Right is the default; bottom spreads the rooms over four columns. */
export function architecturalLegendPosition(area: { architecturalLegendPosition?: string }): ArchitecturalLegendPosition {
  return area.architecturalLegendPosition === "bottom" ? "bottom" : "right";
}
export function architecturalLegendColumnCount(position: ArchitecturalLegendPosition): number {
  return position === "bottom" ? 4 : ARCHITECTURAL_LEGEND_COLUMNS;
}
export const ARCHITECTURAL_LEGEND_BOTTOM_HEIGHT_RATIO = 0.24;

export function architecturalLegendEnabled(area: { showArchitectural?: boolean; showArchitecturalLegend?: boolean }): boolean {
  return area.showArchitectural === true && area.showArchitecturalLegend === true;
}

/** Share one sequence between plan labels and legend without mutating rooms. */
export function architecturalLegendRooms<T extends { id: string; name: string; areaM2: number }>(rooms: readonly T[]) {
  return rooms.map((room, index) => ({ room, number: index + 1 }));
}

/** Two side-by-side columns keep the legend short enough to stay inside the slide. */
export const ARCHITECTURAL_LEGEND_COLUMNS = 2;
export const ARCHITECTURAL_LEGEND_COLUMN_GAP = 36;
export const ARCHITECTURAL_LEGEND_WIDTH_RATIO = 0.22;
export const ARCHITECTURAL_LEGEND_LINE_HEIGHT = 40;
export const ARCHITECTURAL_LEGEND_HEADER_HEIGHT = 112;
/** Space the "12." prefix always occupies on the first line of a room row. */
export const ARCHITECTURAL_LEGEND_NUMBER_PREFIX = 46;

/** Every size is exactly double the single-column legend it replaces. */
export const ARCHITECTURAL_LEGEND_FONTS = { level: 40, elevation: 32, number: 36, name: 34, area: 30 };

export function wrapArchitecturalLegendName(name: string, maxChars: number): string[] {
  const words = (name || "").trim().split(/\s+/).filter(Boolean).flatMap((word) => {
    const parts: string[] = [];
    for (let start = 0; start < word.length; start += Math.max(1, maxChars)) parts.push(word.slice(start, start + Math.max(1, maxChars)));
    return parts;
  });
  if (words.length === 0) return ["Ruang"];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Lay the numbered rooms out in two balanced columns sized in slide pixels,
 * then shrink the whole block only when it still cannot fit the legend box.
 */
export function architecturalLegendLayout<T extends { id: string; name: string; areaM2: number }>(
  rooms: readonly T[],
  box: { width: number; height: number },
  levelName = "",
  columnCount: number = ARCHITECTURAL_LEGEND_COLUMNS,
) {
  const N = Math.max(1, Math.round(columnCount));
  let colW = Math.max(
    90,
    (box.width - ARCHITECTURAL_LEGEND_COLUMN_GAP * (N - 1)) / N,
  );
  let maxChars = Math.max(1, Math.floor((colW - ARCHITECTURAL_LEGEND_NUMBER_PREFIX) / (ARCHITECTURAL_LEGEND_FONTS.name * 0.55)));
  // Reflow before shrinking: dense legends must use the entire right-hand rail.
  let fitScale = 1;
  for (let pass = 0; pass < 60; pass += 1) {
    colW = Math.max(90, (box.width / fitScale - ARCHITECTURAL_LEGEND_COLUMN_GAP * (N - 1)) / N);
    maxChars = Math.max(1, Math.floor((colW - ARCHITECTURAL_LEGEND_NUMBER_PREFIX) / (ARCHITECTURAL_LEGEND_FONTS.name * 0.55)));
    const heights = rooms.map((room) => Math.max(92, wrapArchitecturalLegendName(room.name, maxChars).length * ARCHITECTURAL_LEGEND_LINE_HEIGHT + 52));
    const bestHeight = Math.max(0, ...splitColumns(heights, N).map((col) => col.reduce((x, y) => x + y, 0)));
    if ((ARCHITECTURAL_LEGEND_HEADER_HEIGHT + bestHeight) * fitScale <= box.height) break;
    fitScale *= 0.95;
  }
  const rows = architecturalLegendRooms(rooms).map(({ room, number }) => {
    const nameLines = wrapArchitecturalLegendName(room.name, maxChars);
    return { room, number, nameLines, height: Math.max(92, nameLines.length * ARCHITECTURAL_LEGEND_LINE_HEIGHT + 52) };
  });

  const groups = splitColumns(rows.map((row) => row.height), N);
  let cursor = 0;
  const sliced = groups.map((group) => { const part = rows.slice(cursor, cursor + group.length); cursor += group.length; return part; });
  const columns = sliced.map((column) => {
    let top = ARCHITECTURAL_LEGEND_LINE_HEIGHT;
    return column.map((row) => {
      const placed = { ...row, top };
      top += row.height;
      return placed;
    });
  });

  const contentHeight = Math.max(1, ...columns.map((column) => column.reduce((sum, row) => sum + row.height, 0)));
  const needed = ARCHITECTURAL_LEGEND_HEADER_HEIGHT + contentHeight;
  const scale = Math.min(fitScale, box.height / needed);
  colW = (box.width / scale - ARCHITECTURAL_LEGEND_COLUMN_GAP * (N - 1)) / N;
  const levelFont = Math.min(
    ARCHITECTURAL_LEGEND_FONTS.level,
    ((box.width / scale) * 0.98) / Math.max(1, (levelName || "").length * 0.62),
  );

  return { columns, colW, maxChars, scale, needed, fonts: ARCHITECTURAL_LEGEND_FONTS, levelFont };
}

/** Contiguous split minimising the tallest column (keeps numbers ascending left to right). */
function splitColumns(heights: number[], n: number): number[][] {
  const total = heights.reduce((a, b) => a + b, 0);
  const fits = (limit: number) => {
    let cols = 1, sum = 0;
    for (const h of heights) { if (sum + h > limit) { cols += 1; sum = h; } else sum += h; }
    return cols <= n;
  };
  let lo = Math.max(0, ...heights), hi = Math.max(lo, total);
  for (let i = 0; i < 50 && hi - lo > 0.5; i += 1) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  const out: number[][] = [[]];
  let sum = 0;
  for (const h of heights) {
    if (sum + h > hi && out[out.length - 1].length > 0 && out.length < n) { out.push([]); sum = 0; }
    out[out.length - 1].push(h); sum += h;
  }
  while (out.length < n) out.push([]);
  return out;
}
