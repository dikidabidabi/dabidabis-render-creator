/**
 * Pagination for the "Rincian per Level" slide. Mirrors the Outline
 * Spesifikasi rule: fill each page by available height, continue the
 * remaining rows of a level on the next page, and repeat the level identity
 * (header + table heading) on every continuation.
 */
export type RincianLayout = {
  /** Usable content height on one slide, px. */
  budget: number;
  /** Level header + table heading + bottom margin, px. */
  sectionOverhead: number;
  /** Total row shown after the last row of a level, px. */
  totalRowHeight: number;
  /** Placeholder height for a level without rooms, px. */
  emptyHeight: number;
};

export type RincianChunk<T> = {
  levelIndex: number;
  rows: T[];
  partIndex: number;
  partCount: number;
};

export function paginateRincianLevels<T>(
  levels: T[][],
  rowHeight: (row: T) => number,
  layout: RincianLayout,
): RincianChunk<T>[][] {
  const pages: RincianChunk<T>[][] = [];
  let page: RincianChunk<T>[] = [];
  let used = 0;
  const flush = () => {
    if (page.length) pages.push(page);
    page = [];
    used = 0;
  };

  levels.forEach((rows, levelIndex) => {
    if (rows.length === 0) {
      const h = layout.sectionOverhead + layout.emptyHeight;
      if (page.length && used + h > layout.budget) flush();
      const chunk = { levelIndex, rows: [], partIndex: 1, partCount: 1 };
      page.push(chunk);
      used += h;
      return;
    }
    const levelChunks: RincianChunk<T>[] = [];
    let chunk: RincianChunk<T> | null = null;
    rows.forEach((row, rowIndex) => {
      const isLast = rowIndex === rows.length - 1;
      const h = rowHeight(row);
      const tail = isLast ? layout.totalRowHeight : 0;
      const opening = chunk ? 0 : layout.sectionOverhead;
      const fits = used + opening + h + tail <= layout.budget;
      // Always place at least one row on an otherwise empty page.
      if (!fits && (page.length > 0 || (chunk && chunk.rows.length > 0))) {
        flush();
        chunk = null;
      }
      if (!chunk) {
        chunk = { levelIndex, rows: [], partIndex: levelChunks.length + 1, partCount: 1 };
        levelChunks.push(chunk);
        page.push(chunk);
        used += layout.sectionOverhead;
      }
      chunk.rows.push(row);
      used += h;
      if (isLast) used += layout.totalRowHeight;
    });
    levelChunks.forEach((c) => { c.partCount = levelChunks.length; });
  });
  flush();
  return pages;
}

/** Estimated wrapped line count for text in a fixed-width cell. */
export function rincianTextLines(value: string | undefined, charsPerLine: number): number {
  const lines = (value || "—").split(/\r?\n/);
  return lines.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}
