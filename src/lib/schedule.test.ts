import { describe, expect, test } from "bun:test";
import { normalizeSchedule, scheduleDue, scheduleDuration, scheduleProgress, totalScheduleProgress, type ScheduleTask } from "./schedule";

const task: ScheduleTask = { id: "task", wbs: "1.1", title: "Survei", owner: "", start: "2026-09-02", due: "2026-09-30", status: "belum", component: "", color: "lavender", stage: false, checks: [{ id: "a", title: "Ukur", done: true }, { id: "b", title: "Catat", done: false }] };
describe("Jadwal pekerjaan", () => {
  test("persentase mengikuti ceklis subpekerjaan", () => {
    expect(scheduleProgress(task, [task])).toBe(50);
    expect(scheduleProgress({ ...task, checks: task.checks.map((c) => ({ ...c, done: true })) }, [])).toBe(100);
    expect(scheduleProgress({ ...task, checks: [] }, [])).toBe(0);
  });
  test("tahap mengikuti progres anak WBS tanpa menghitung ganda", () => {
    const stage: ScheduleTask = { ...task, id: "stage", wbs: "1", stage: true, checks: [] };
    const other: ScheduleTask = { ...task, id: "other", wbs: "2.1", checks: [{ id: "c", title: "Selesai", done: true }] };
    expect(scheduleProgress(stage, [stage, task, other])).toBe(50);
    expect(totalScheduleProgress([stage, task, other])).toBe(66.7);
  });
  test("durasi sama dengan contoh 2–30 September dan perubahan durasi mengubah tenggat", () => {
    expect(scheduleDuration("2026-09-02", "2026-09-30")).toBe(28);
    expect(scheduleDue("2026-09-02", 28)).toBe("2026-09-30");
    expect(scheduleDuration("2026-09-02", "2026-09-02")).toBe(0);
  });
  test("data tidak valid ditolak saat pemuatan", () => {
    expect(normalizeSchedule([task, { ...task, start: "2026-02-30" }, { ...task, due: "2026-09-01" }])).toHaveLength(1);
  });
});