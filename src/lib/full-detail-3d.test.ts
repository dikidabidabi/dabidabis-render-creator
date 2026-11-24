import { describe, expect, it } from "vitest";
import { buildFullDetail3d } from "./level-detail-3d";

const room = (levelId: string) => ({ id: `r-${levelId}`, name: "Kantor", levelId, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], color: "#ccc" });

describe("Detail 3D full", () => {
  it("menumpuk semua lantai pada elevasi sebenarnya", () => {
    const sketch = { scale: 1, levels: [{ id: "a", name: "LT 1", mdpl: 0 }, { id: "b", name: "LT 2", mdpl: 4 }], layers: [room("a"), room("b")] };
    const model = buildFullDetail3d(sketch as never, 20);
    const floors = model.prisms.filter((p) => p.kind === "floor");
    expect(floors.some((p) => p.top <= 0.01)).toBe(true);
    expect(floors.some((p) => p.top > 3.9 && p.top < 4.1)).toBe(true);
  });
});
