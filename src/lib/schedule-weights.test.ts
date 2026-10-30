import { test } from "node:test";
import { strict as assert } from "node:assert";
import { copyScheduleEntry, normalizeSchedule, type ScheduleTask } from "./schedule";
import { DEFAULT_SCHEDULE_VIEW, normalizeScheduleViews } from "./schedule-analysis";
import { scheduleWeights, weeklyTaskWeights, weeklyScheduleSummary } from "./schedule-weights";

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

const summaryFixture = () => {
  const tasks = [task("1", 100), { ...task("1.1"), start: "2026-10-05", due: "2026-10-19", progressEntries: [{ date: "2026-10-09", actual: 20 }, { date: "2026-10-16", actual: 100 }] }, { ...task("1.2"), start: "2026-10-05", due: "2026-10-19", progressEntries: [{ date: "2026-10-09", actual: 40 }, { date: "2026-10-16", actual: 100 }] }];
  return weeklyScheduleSummary(tasks, scheduleWeights(tasks), [new Date("2026-10-05"), new Date("2026-10-12")], "2026-10-30");
};
test("bobot rencana mingguan menjumlah daun saja: dua anak 50% selama 14 hari = 50% per minggu", () => {
  assert.deepEqual(summaryFixture().map((week) => week.plan), [50, 50]);
});
test("akumulasi rencana menambah minggu sebelumnya dan minggu terakhir mencapai 100%", () => {
  assert.deepEqual(summaryFixture().map((week) => week.planCumulative), [50, 100]);
});
test("bobot realisasi mingguan menjumlah capaian: 50% × 20% + 50% × 40% = 30%", () => {
  assert.deepEqual(summaryFixture().map((week) => week.actual), [30, 70]);
});
test("akumulasi realisasi menambah minggu sebelumnya dan mencapai 100% saat selesai", () => {
  assert.deepEqual(summaryFixture().map((week) => week.actualCumulative), [30, 100]);
});
test("realisasi belum selesai tidak dipaksakan 100% dan minggu mendatang belum memiliki realisasi", () => {
  const t = { ...task("1", 100), start: "2026-10-05", due: "2026-10-19", progressEntries: [{ date: "2026-10-09", actual: 20 }] };
  const weeks = weeklyScheduleSummary([t], scheduleWeights([t]), [new Date("2026-10-05"), new Date("2026-10-12")], "2026-10-09");
  assert.equal(weeks[0].actualCumulative, 20);
  assert.equal(weeks[1].actualCumulative, null);
});
test("ringkasan tanpa bobot manual memakai pembobotan durasi yang sama dengan kurva", () => {
  const tasks = [{ ...task("1"), start: "2026-10-05", due: "2026-10-19" }];
  const weeks = weeklyScheduleSummary(tasks, scheduleWeights(tasks), [new Date("2026-10-05"), new Date("2026-10-12")], "2026-10-30");
  assert.deepEqual(weeks.map((week) => week.plan), [50, 50]);
  assert.equal(weeks.at(-1)?.planCumulative, 100);
});
