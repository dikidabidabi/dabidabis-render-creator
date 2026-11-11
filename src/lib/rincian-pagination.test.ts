import { describe, expect, it } from "vitest";
import { paginateRincianLevels } from "./rincian-pagination";

const layout = { budget: 300, sectionOverhead: 60, totalRowHeight: 30, emptyHeight: 30 };
const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("paginateRincianLevels", () => {
  it("continues a level's remaining rows on the next page and marks the parts", () => {
    // 60 overhead + 20 rows × 20 = 460 > 300 → must split.
    const pages = paginateRincianLevels([rows(20)], () => 20, layout);
    expect(pages.length).toBe(2);
    expect(pages[0][0].rows.length).toBe(12); // 60 + 12×20 = 300
    expect(pages[1][0].rows.length).toBe(8);
    expect(pages[1][0].partIndex).toBe(2);
    expect(pages[0][0].partCount).toBe(2);
  });

  it("keeps a page within the height budget including the total row", () => {
    const pages = paginateRincianLevels([rows(3), rows(5)], () => 20, layout);
    for (const page of pages) {
      const h = page.reduce((sum, c) => sum + 60 + c.rows.length * 20 + (c.partIndex === c.partCount ? 30 : 0), 0);
      expect(h).toBeLessThanOrEqual(300);
    }
    expect(pages.flat().reduce((s, c) => s + c.rows.length, 0)).toBe(8);
  });

  it("starts a level on the next page when not even one row fits", () => {
    const pages = paginateRincianLevels([rows(10), rows(4)], () => 20, layout);
    // Level 0 uses 60 + 200 + 30 = 290 → level 1 cannot open on page 1.
    expect(pages[0].length).toBe(1);
    expect(pages[1][0].levelIndex).toBe(1);
  });
});
