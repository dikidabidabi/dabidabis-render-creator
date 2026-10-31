import { test } from "node:test";
import { strict as assert } from "node:assert";
import { editScheduleCost, scheduleCosts } from "./schedule-costs";
import { scheduleWeights, weightedPlanAt } from "./schedule-weights";
import { readScheduleCollections, serializeScheduleCollections, copyNamedSchedules } from "./schedule-collections";
import { DEFAULT_SCHEDULE_VIEW } from "./schedule-analysis";
import type { ScheduleTask } from "./schedule";

const task = (wbs: string, cost?: number): ScheduleTask => ({ id: wbs, wbs, title: wbs, owner: "", start: "2026-10-01", due: "2026-10-15", status: "belum", component: "", color: "stage", stage: false, checks: [], cost });

test("manual root cost leaves remaining project budget divided equally", () => {
  const costs = scheduleCosts([task("1", 400), task("2"), task("3")], 1000);
  assert.equal(costs.get("1"), 400);
  assert.equal(costs.get("2"), 300);
  assert.equal(costs.get("3"), 300);
});
test("editing another root preserves earlier manual values and redistributes only automatic siblings", () => {
  const tasks = editScheduleCost([task("1", 400), task("2"), task("3"), task("4")], "2", 200, 1000);
  const costs = scheduleCosts(tasks, 1000);
  assert.deepEqual([...costs.values()], [400, 200, 200, 200]);
  assert.equal(tasks[2].cost, undefined);
});
test("two-part WBS splits remaining parent cost after manual child edits", () => {
  const costs = scheduleCosts([task("1", 400), task("1.1", 100), task("1.2"), task("1.3")], 1000);
  assert.equal(costs.get("1.1"), 100);
  assert.equal(costs.get("1.2"), 150);
  assert.equal(costs.get("1.3"), 150);
});
test("three-part and deeper WBS apply the same remaining-budget rule", () => {
  const costs = scheduleCosts([task("1"), task("1.1"), task("1.1.1", 200), task("1.1.2"), task("1.1.2.1", 300), task("1.1.2.2")], 1000);
  assert.equal(costs.get("1.1.2"), 800);
  assert.equal(costs.get("1.1.2.2"), 500);
});
test("weights use each task cost divided by project total regardless of visibility", () => {
  const tasks = [task("1"), task("1.1", 200), task("1.2")];
  const weights = scheduleWeights(tasks, 1000);
  assert.equal(weights.get("1.1"), 20);
  assert.equal(weights.get("1.2"), 80);
  assert.equal(weightedPlanAt(tasks, weights, "2026-10-15"), 100);
});
test("without positive project total existing manual weights remain unchanged", () => {
  const tasks = [{ ...task("1", 500), weight: 35 }, task("1.1"), task("1.2")];
  assert.equal(scheduleWeights(tasks).get("1.1"), 17.5);
  assert.equal(scheduleWeights(tasks, 0).get("1"), 35);
});
test("clearing a manual cost restores equal automatic sharing", () => {
  const tasks = editScheduleCost([task("1", 400), task("2", 200), task("3")], "2", undefined, 1000);
  assert.equal(scheduleCosts(tasks, 1000).get("2"), 300);
});
test("over-budget and invalid edits cannot overwrite manual allocations", () => {
  assert.throws(() => editScheduleCost([task("1", 400), task("2")], "2", 700, 1000));
  assert.throws(() => scheduleCosts([task("1", 400), task("1.1", 500)], 1000));
  assert.throws(() => editScheduleCost([task("1")], "1", -1, 1000));
  assert.throws(() => editScheduleCost([task("1")], "1", NaN, 1000));
});
test("cost settings and manual costs survive reload and copied schedules stay independent", () => {
  const original = { a: [{ id: "schedule", name: "Jadwal", tasks: [task("1", 400), task("2")], view: { ...DEFAULT_SCHEDULE_VIEW, costs: true, projectCost: 1000 } }] };
  const loaded = readScheduleCollections(JSON.parse(serializeScheduleCollections(original)));
  assert.equal(loaded.a[0].view.costs, true);
  assert.equal(loaded.a[0].view.projectCost, 1000);
  assert.equal(loaded.a[0].tasks[0].cost, 400);
  assert.equal(loaded.a[0].tasks[1].cost, undefined);
  const copy = copyNamedSchedules(loaded, "a", "b");
  copy.b[0].view.projectCost = 2000;
  copy.b[0].tasks[0].cost = 500;
  assert.equal(copy.a[0].view.projectCost, 1000);
  assert.equal(copy.a[0].tasks[0].cost, 400);
});