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
export const ARCHITECTURAL_LEGEND_WIDTH_RATIO = 0.28;
export const ARCHITECTURAL_LEGEND_LINE_HEIGHT = 40;
export const ARCHITECTURAL_LEGEND_HEADER_HEIGHT = 112;
/** Space the "12." prefix always occupies on the first line of a room row. */
export const ARCHITECTURAL_LEGEND_NUMBER_PREFIX = 46;

/** Every size is exactly double the single-column legend it replaces. */
export const ARCHITECTURAL_LEGEND_FONTS = { level: 40, elevation: 32, number: 36, name: 34, area: 30 };

export function wrapArchitecturalLegendName(name: string, maxChars: number): string[] {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
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
) {
  const colW = Math.max(
    90,
    (box.width - ARCHITECTURAL_LEGEND_COLUMN_GAP * (ARCHITECTURAL_LEGEND_COLUMNS - 1)) / ARCHITECTURAL_LEGEND_COLUMNS,
  );
  const maxChars = Math.max(6, Math.floor((colW - ARCHITECTURAL_LEGEND_NUMBER_PREFIX) / (ARCHITECTURAL_LEGEND_FONTS.name * 0.55)));
  const rows = architecturalLegendRooms(rooms).map(({ room, number }) => {
    const nameLines = wrapArchitecturalLegendName(room.name, maxChars);
    return { room, number, nameLines, height: Math.max(92, nameLines.length * ARCHITECTURAL_LEGEND_LINE_HEIGHT + 52) };
  });

  let split = 0;
  let tallest = Infinity;
  for (let index = 0; index <= rows.length; index += 1) {
    const left = rows.slice(0, index).reduce((sum, row) => sum + row.height, 0);
    const right = rows.slice(index).reduce((sum, row) => sum + row.height, 0);
    if (Math.max(left, right) < tallest) {
      tallest = Math.max(left, right);
      split = index;
    }
  }

  const columns = [rows.slice(0, split), rows.slice(split)].map((column) => {
    let top = ARCHITECTURAL_LEGEND_LINE_HEIGHT;
    return column.map((row) => {
      const placed = { ...row, top };
      top += row.height;
      return placed;
    });
  });

  const contentHeight = Math.max(1, ...columns.map((column) => column.reduce((sum, row) => sum + row.height, 0)));
  const needed = ARCHITECTURAL_LEGEND_HEADER_HEIGHT + contentHeight;
  const scale = needed > box.height ? box.height / needed : 1;
  const levelFont = Math.min(
    ARCHITECTURAL_LEGEND_FONTS.level,
    ((box.width / scale) * 0.98) / Math.max(1, (levelName || "").length * 0.62),
  );

  return { columns, colW, maxChars, scale, needed, fonts: ARCHITECTURAL_LEGEND_FONTS, levelFont };
}
