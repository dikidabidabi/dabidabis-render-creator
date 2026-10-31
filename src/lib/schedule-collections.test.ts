import { test } from "node:test";
import { strict as assert } from "node:assert";
import { addNamedSchedule, copyNamedSchedules, deleteNamedSchedule, readScheduleCollections, renameNamedSchedule, schedulesForSketch, serializeScheduleCollections } from "./schedule-collections";

test("one sketch can have multiple independent schedules", () => {
  const store = addNamedSchedule({}, "sketch-a", "second");
  assert.equal(store["sketch-a"].length, 2);
  assert.deepEqual(store["sketch-a"][1].tasks, []);
  assert.equal(schedulesForSketch(store, "sketch-b").length, 1);
  assert.equal(store["sketch-a"][0].view.weights, false);
});
test("renaming affects only the selected schedule and persists", () => {
  const store = renameNamedSchedule(addNamedSchedule({}, "a", "second"), "a", "second", "  Pelaksanaan  ");
  const restored = readScheduleCollections(JSON.parse(serializeScheduleCollections(store)));
  assert.equal(restored.a[1].name, "Pelaksanaan");
  assert.equal(restored.a[0].name, "Jadwal");
  assert.throws(() => renameNamedSchedule(store, "a", "second", " "));
});
test("deletion requires confirmation and does not delete the sketch or sibling schedules", () => {
  const store = addNamedSchedule({}, "a", "second");
  assert.equal(deleteNamedSchedule(store, "a", "second", false), store);
  const next = deleteNamedSchedule(store, "a", "second", true);
  assert.equal(next.a.length, 1);
  assert.equal(next.a[0].id, "a");
  const empty = deleteNamedSchedule(next, "a", "a", true);
  assert.deepEqual(schedulesForSketch(readScheduleCollections(JSON.parse(serializeScheduleCollections(empty))), "a"), []);
});
test("legacy schedules and their view settings migrate without losing tasks", () => {
  const task = { id: "t", title: "Survei", wbs: "1", owner: "", start: "2026-10-01", due: "2026-10-08", status: "belum", component: "", color: "stage", stage: true, checks: [], weight: 100 };
  const store = readScheduleCollections({ a: [task] }, { a: { weights: true, collapsed: ["t"], cpm: true, slack: 2 } });
  assert.equal(store.a[0].tasks[0].weight, 100);
  assert.equal(store.a[0].view.weights, true);
  assert.deepEqual(store.a[0].view.collapsed, ["t"]);
  assert.equal(readScheduleCollections([task], {}, "active").active[0].tasks[0].id, "t");
  const copy = copyNamedSchedules(addNamedSchedule(store, "a", "second"), "a", "b");
  assert.equal(copy.b.length, 2);
  assert.equal(copy.b[0].view.slack, 2);
  copy.b[0].tasks[0].title = "Changed";
  assert.equal(copy.a[0].tasks[0].title, "Survei");
  assert.notEqual(copy.a[0].id, copy.b[0].id);
});