import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { scheduleTimelineRange, todayInTimeline, toggleHiddenColumn, visibleScheduleColumns } from "./schedule-timeline";
import { normalizeScheduleViews } from "./schedule-analysis";
import type { ScheduleTask } from "./schedule";

const task = (start: string, due: string): ScheduleTask => ({ id: start, taskNumber: 1, wbs: "1", title: "A", owner: "", start, due, status: "belum", component: "", color: "green", stage: false, checks: [] });

test("Gantt dimulai dari tanggal terawal walau hari ini jauh sebelumnya", () => {
  const range = scheduleTimelineRange([task("2027-03-10", "2027-05-01")], new Date(2026, 10, 10));
  assert.equal(format(range.start, "yyyy-MM-dd"), "2027-03-10");
});

test("garis hari ini hilang bila hari ini di luar rentang jadwal", () => {
  const range = scheduleTimelineRange([task("2027-03-10", "2027-05-01")], new Date(2026, 10, 10));
  assert.equal(todayInTimeline(range, new Date(2026, 10, 10)), false);
  assert.equal(todayInTimeline(range, new Date(2027, 3, 1)), true);
  assert.equal(todayInTimeline(range, new Date(2027, 4, 2)), false);
});

test("kolom mulai Penanggung jawab ke kanan dapat disembunyikan dan dimunculkan", () => {
  let hidden = toggleHiddenColumn([], "owner");
  hidden = toggleHiddenColumn(hidden, "weight");
  assert.deepEqual(visibleScheduleColumns(false, hidden).map((c) => c.key).includes("owner"), false);
  assert.equal(visibleScheduleColumns(false, hidden).some((c) => c.key === "weight"), false);
  assert.deepEqual(toggleHiddenColumn(hidden, "owner"), ["weight"]);
  assert.deepEqual(toggleHiddenColumn([], "title"), []);
  assert.deepEqual(toggleHiddenColumn([], "wbs"), []);
});

test("pilihan kolom tersembunyi tersimpan di pengaturan jadwal", () => {
  assert.deepEqual(normalizeScheduleViews({ a: { hiddenColumns: ["owner", "owner", 3] } }).a.hiddenColumns, ["owner"]);
});
