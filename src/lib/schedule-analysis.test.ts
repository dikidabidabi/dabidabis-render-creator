import { test } from "node:test";
import { strict as assert } from "node:assert";
import { criticalPath, visibleSchedule, plannedProgress, weightedProgress, recordObservation } from "./schedule-analysis";
import type { ScheduleTask } from "./schedule";
const task = (id: string, wbs: string, start: string, due: string): ScheduleTask => ({ id, wbs, start, due, title: id, owner: "", status: "belum", component: "", color: "lavender", stage: false, checks: [{ id: "check", title: "Selesai", done: false }] });
const a = task("a", "1.1", "2026-10-01", "2026-10-11");
const b = { ...task("b", "1.2", "2026-10-11", "2026-10-16"), predecessor: { taskId: "a", type: "FS" as const } };
test("lipat semua turunan tanpa menyembunyikan WBS 10 dan keadaan lipat anak tetap ada", () => {
  const parent = task("p", "1", a.start, b.due), child = task("c", "1.1.1", a.start, a.due), other = task("o", "10.1", a.start, a.due);
  assert.deepEqual(visibleSchedule([parent, a, child, other], ["p", "a"]).map((t) => t.id), ["p", "o"]);
  assert.deepEqual(visibleSchedule([parent, a, child, other], ["a"]).map((t) => t.id), ["p", "a", "o"]);
});
test("CPM default slack 0 menyorot rantai terpanjang; slack 5 memasukkan cabang", () => {
  const c = task("c", "2.1", a.start, a.due);
  const result = criticalPath([a, b, c]);
  assert.deepEqual([...result.critical].sort(), ["a", "b"]);
  assert.equal(result.floats.get("c"), 5);
  assert.equal(criticalPath([a, b, c], 5).critical.has("c"), true);
});
for (const type of ["SS", "FF", "SF"] as const) test(`CPM memakai batas ${type} dan tidak mengubah tanggal`, () => {
  const target = { ...task("b", "2", "2026-10-01", "2026-10-06"), predecessor: { taskId: "a", type } };
  const result = criticalPath([a, target]);
  assert.equal(result.duration, 10);
  assert.equal(result.floats.get("b"), type === "FF" ? 0 : 5);
  assert.equal(target.start, "2026-10-01");
});
test("Kurva S berbobot durasi tidak menghitung induk dua kali dan rencana mencapai 100%", () => {
  const parent = task("p", "1", a.start, b.due);
  const tasks = [parent, { ...a, checks: [{ id: "check", title: "Selesai", done: true }] }, b];
  assert.equal(weightedProgress(tasks), 100 * 10 / 15);
  assert.equal(plannedProgress(tasks, "2026-10-01"), 0);
  assert.equal(plannedProgress(tasks, "2026-10-11"), 100 * 10 / 15);
  assert.equal(plannedProgress(tasks, "2026-10-16"), 100);
});
test("riwayat progres hanya mencatat tanggal pengamatan dan mengganti hari sama", () => {
  const first = recordObservation([], [a], new Date("2026-10-24T12:00:00"));
  const updated = recordObservation(first, [{ ...a, checks: a.checks.map((c) => ({ ...c, done: true })) }], new Date("2026-10-24T12:00:00"));
  assert.deepEqual(updated, [{ date: "2026-10-24", actual: 100 }]);
});