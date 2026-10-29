import { test } from "node:test";
import { strict as assert } from "node:assert";
import { copyScheduleEntry, normalizeSchedule, type ScheduleTask } from "./schedule";
import { DEFAULT_SCHEDULE_VIEW, normalizeScheduleViews } from "./schedule-analysis";
import { scheduleWeights, weeklyTaskWeights } from "./schedule-weights";

const task = (wbs: string, weight?: number): ScheduleTask => ({ id: wbs, wbs, weight, title: wbs, owner: "", start: "2026-10-01", due: "2026-10-15", status: "belum", component: "", color: "lavender", stage: false, checks: [] });
test("WBS 1 berbobot 35% membagi 1.1 hingga 1.5 masing-masing 7%", () => {
  const tasks = [task("1", 35), ...[1, 2, 3, 4, 5].map((n) => task(`1.${n}`, 99))];
  const weights = scheduleWeights(tasks);
  assert.equal(weights.get("1"), 35);
  tasks.slice(1).forEach((child) => assert.equal(weights.get(child.id), 7));
});
test("anak membagi bobot induk langsung secara bertingkat, bukan semua turunan sekaligus", () => {
  const weights = scheduleWeights([task("1", 35), task("1.1"), task("1.2"), task("1.1.1"), task("1.1.2"), task("10", 20), task("10.1")]);
  assert.equal(weights.get("1.1"), 17.5);
  assert.equal(weights.get("1.1.1"), 8.75);
  assert.equal(weights.get("10.1"), 20);
  assert.equal(scheduleWeights([task("1.1", 99)]).get("1.1"), 0);
});
test("bobot 14% selama 14 hari menjadi 7% setiap minggu", () => {
  assert.deepEqual(weeklyTaskWeights(task("1.1"), 14), [{ start: "2026-10-01", days: 7, weight: 7 }, { start: "2026-10-08", days: 7, weight: 7 }]);
});
test("sisa minggu proporsional dan seluruh bobot tetap teralokasikan", () => {
  const weeks = weeklyTaskWeights({ ...task("1.1"), due: "2026-10-11" }, 14);
  assert.deepEqual(weeks.map((week) => week.weight), [9.8, 4.2]);
  assert.equal(weeks.reduce((sum, week) => sum + week.weight, 0), 14);
  assert.equal(weeklyTaskWeights({ ...task("1"), due: "2026-10-01" }, 14)[0]?.weight, 14);
});
test("ceklis bobot default nonaktif dan tersimpan per sketsa", () => {
  assert.equal(DEFAULT_SCHEDULE_VIEW.weights, false);
  const views = normalizeScheduleViews({ a: { weights: true }, b: {} });
  assert.equal(views.a.weights, true);
  assert.equal(views.b.weights, false);
});
test("bobot manual dipertahankan saat muat ulang dan salin sketsa", () => {
  const tasks = normalizeSchedule([task("1", 35)]);
  assert.equal(tasks[0]?.weight, 35);
  assert.equal(copyScheduleEntry({ source: tasks }, "source", "target").target[0]?.weight, 35);
});import { weeklyActualWeights, weightedActualAt } from "./schedule-weights";
test("bobot rencana 10% dengan realisasi 20% di minggu ke-2 menghasilkan bobot realisasi 2%", () => {
  const t: ScheduleTask = { ...task("1", 10), progressEntries: [{ date: "2026-10-09", actual: 20 }] };
  const weeks = weeklyActualWeights(t, 10, [t], "2026-10-20");
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].start, "2026-10-08");
  assert.ok(Math.abs(weeks[0].weight - 2) < 1e-9);
  assert.ok(Math.abs(weightedActualAt([t], new Map([["1", 10]]), "2026-10-20", "2026-10-20") - 2) < 1e-9);
});
