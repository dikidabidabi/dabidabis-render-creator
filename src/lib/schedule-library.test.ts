import { test } from "node:test";
import { strict as assert } from "node:assert";
import { applyScheduleTemplate, readScheduleLibrary, validateTemplate, type ScheduleTemplate } from "./schedule-library";
import { predecessorText, scheduleDuration, type ScheduleTask } from "./schedule";

const template: ScheduleTemplate = { id: "template", works: [
  { id: "r", wbs: "a", title: "Arsitektur", duration: 20, predecessor: "" },
  { id: "c1", wbs: "a.a", title: "Lantai", duration: 7, predecessor: "" },
  { id: "g", wbs: "a.a.a", title: "Persiapan", duration: 2, predecessor: "" },
  { id: "gg", wbs: "a.a.a.a", title: "Ukur", duration: 1, predecessor: "" },
  { id: "c2", wbs: "a.b", title: "Dinding", duration: 9, predecessor: "a.aFS+2;a.a.aSS-1" },
] };
const task: ScheduleTask = { id: "existing", taskNumber: 12, wbs: "3", title: "Lama", start: "2026-10-01", due: "2026-10-08", owner: "", component: "", status: "belum", color: "stage", stage: true, checks: [] };
let count = 0;
const ids = () => `new-${++count}`;

test("letter hierarchy becomes next numerical root and all four levels", () => {
  const result = applyScheduleTemplate([task], template, "2026-10-01", undefined, ids);
  assert.deepEqual(result.map((row) => row.wbs), ["3", "4", "4.1", "4.1.1", "4.1.1.1", "4.2"]);
  assert.equal(result.length, 6);
  assert.equal(result[2].title, "Lantai");
});
test("each duration is adopted and predecessors use destination UUIDs and IDs", () => {
  const result = applyScheduleTemplate([task], template, "2026-10-01", undefined, ids);
  const floor = result[2], wall = result[5];
  assert.equal(scheduleDuration(wall.start, wall.due), 9);
  assert.equal(scheduleDuration(floor.start, floor.due), 7);
  assert.equal(wall.start, "2026-10-10");
  assert.equal(wall.predecessors?.[0].taskId, floor.id);
  assert.equal(predecessorText(wall, result), "14FS+2;15SS-1");
});
test("selecting any descendant replaces its entire root group only", () => {
  const child = { ...task, id: "child", taskNumber: 13, wbs: "3.1" };
  const unrelated = { ...task, id: "other", taskNumber: 14, wbs: "2" };
  const result = applyScheduleTemplate([unrelated, task, child], template, task.start, child.id, ids);
  assert.equal(result.find((row) => row.wbs === "3")?.id, task.id);
  assert.equal(result.find((row) => row.wbs === "3.1")?.id, child.id);
  assert.equal(result.find((row) => row.id === unrelated.id), unrelated);
  assert.equal(result.length, 6);
  assert.equal(task.title, "Lama");
});
test("repeated template calls isolate all task and predecessor IDs", () => {
  const first = applyScheduleTemplate([], template, task.start, undefined, ids);
  const next = applyScheduleTemplate(first, template, task.start, undefined, ids);
  const second = next.filter((row) => row.wbs.startsWith("2"));
  assert.equal(new Set(next.map((row) => row.id)).size, 10);
  assert.ok(second[4].predecessors?.every((link) => second.some((row) => row.id === link.taskId)));
});
test("library persists hierarchy, duration and predecessor", () => {
  assert.deepEqual(readScheduleLibrary(JSON.stringify([template])), [validateTemplate(template)]);
});
test("invalid WBS, missing parent, missing predecessor and cycles are rejected", () => {
  assert.throws(() => validateTemplate({ ...template, works: [{ ...template.works[0], wbs: "1" }] }));
  assert.throws(() => validateTemplate({ ...template, works: [template.works[0], template.works[3]] }));
  assert.throws(() => validateTemplate({ ...template, works: [{ ...template.works[0], predecessor: "a.bFS" }] }));
  assert.throws(() => validateTemplate({ ...template, works: [{ ...template.works[0], predecessor: "a.aFS" }, { ...template.works[1], predecessor: "aFS" }] }));
});