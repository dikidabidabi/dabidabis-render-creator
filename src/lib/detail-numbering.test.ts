import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { renumberDetailAreas } from "./detail-numbering";
const levels = [{ id: "lt2", mdpl: 3 }, { id: "lt1", mdpl: 0 }, { id: "basement", mdpl: -3 }];
const furniture = [{ id: "sofa", x: 15, y: 20, rotation: 45 }];
const areas = [
  { id: "a", levelId: "lt1", number: 1, furniture: [] },
  { id: "b", levelId: "lt1", number: 2, furniture: [] },
  { id: "c", levelId: "lt2", number: 3, furniture },
  { id: "d", levelId: "lt2", number: 4, furniture: [] },
];
describe("detail numbering", () => {
  test("insertion on LT 1 shifts LT 2 without modifying furniture or IDs", () => {
    const next = renumberDetailAreas([...areas, { id: "e", levelId: "lt1", number: 5, furniture: [] }], levels);
    assert.deepEqual(next.map(({ id, number }) => [id, number]), [["a", 1], ["b", 2], ["e", 3], ["c", 4], ["d", 5]]);
    assert.equal(next.find(({ id }) => id === "c")?.furniture, furniture);
    assert.equal(areas[2].number, 3);
    assert.deepEqual(renumberDetailAreas(next, levels), next);
  });
  test("lowest elevation comes first, not level array order", () => {
    assert.deepEqual(renumberDetailAreas([...areas, { id: "z", levelId: "basement", number: 5, furniture: [] }], levels).map(({ id }) => id), ["z", "a", "b", "c", "d"]);
  });
  test("removal closes gaps and elevation edits reorder floors", () => {
    assert.deepEqual(renumberDetailAreas(areas.filter(({ id }) => id !== "b"), levels).map(({ number }) => number), [1, 2, 3]);
    assert.deepEqual(renumberDetailAreas(areas, [{ id: "lt2", mdpl: -1 }, { id: "lt1", mdpl: 0 }]).map(({ id }) => id), ["c", "d", "a", "b"]);
  });
  test("duplicate numbers stay stable and unknown floors are retained", () => {
    const input = [{ levelId: "lt1", number: 1, id: "a" }, { levelId: "lt1", number: 1, id: "b" }, { levelId: "missing", number: 1, id: "c" }];
    assert.deepEqual(renumberDetailAreas(input, levels).map(({ id, number }) => [id, number]), [["a", 1], ["b", 2], ["c", 3]]);
    assert.deepEqual(renumberDetailAreas([], levels), []);
  });
});
