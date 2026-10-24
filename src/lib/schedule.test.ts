import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { normalizeSchedule, normalizeScheduleStore, readSketchStore, scheduleDue, scheduleDuration, scheduleProgress, totalScheduleProgress, type ScheduleTask } from "./schedule";

const task: ScheduleTask = { id: "task", wbs: "1.1", title: "Survei", owner: "", start: "2026-09-02", due: "2026-09-30", status: "belum", component: "", color: "lavender", stage: false, checks: [{ id: "a", title: "Ukur", done: true }, { id: "b", title: "Catat", done: false }] };
describe("Jadwal pekerjaan", () => {
  test("persentase mengikuti ceklis subpekerjaan", () => {
    assert.equal(scheduleProgress(task, [task]), 50);
    assert.equal(scheduleProgress({ ...task, checks: task.checks.map((c) => ({ ...c, done: true })) }, []), 100);
    assert.equal(scheduleProgress({ ...task, checks: [] }, []), 0);
  });
  test("tahap mengikuti progres anak WBS tanpa menghitung ganda", () => {
    const stage: ScheduleTask = { ...task, id: "stage", wbs: "1", stage: true, checks: [] };
    const other: ScheduleTask = { ...task, id: "other", wbs: "2.1", checks: [{ id: "c", title: "Selesai", done: true }] };
    assert.equal(scheduleProgress(stage, [stage, task, other]), 50);
    assert.equal(totalScheduleProgress([stage, task, other]), 66.7);
  });
  test("durasi sama dengan contoh 2–30 September dan perubahan durasi mengubah tenggat", () => {
    assert.equal(scheduleDuration("2026-09-02", "2026-09-30"), 28);
    assert.equal(scheduleDue("2026-09-02", 28), "2026-09-30");
    assert.equal(scheduleDuration("2026-09-02", "2026-09-02"), 0);
  });
  test("data tidak valid ditolak saat pemuatan", () => {
    assert.equal(normalizeSchedule([task, { ...task, start: "2026-02-30" }, { ...task, due: "2026-09-01" }]).length, 1);
  });
  test("jadwal tersimpan terpisah per sketsa", () => {
    const store = normalizeScheduleStore({ a: [task], b: [{ ...task, id: "lain", wbs: "2.1" }] });
    assert.equal(store.a?.length, 1);
    assert.equal(store.b?.[0]?.id, "lain");
    assert.equal(normalizeScheduleStore({ a: "rusak" }).a, undefined);
  });
  test("jadwal format lama dipindahkan ke sketsa aktif", () => {
    const store = normalizeScheduleStore([task], "sketsa-1");
    assert.equal(store["sketsa-1"]?.length, 1);
    assert.deepEqual(normalizeScheduleStore([task], null), {});
  });
  test("daftar judul sketsa dibaca dari store sketsa", () => {
    const raw = JSON.stringify({ sketches: [{ id: "s1", title: "Rumah A" }, { id: "s2" }, { title: "tanpa id" }], openId: "s2" });
    const store = readSketchStore(raw);
    assert.deepEqual(store.sketches, [{ id: "s1", title: "Rumah A" }, { id: "s2", title: "Sketsa tanpa judul" }]);
    assert.equal(store.openId, "s2");
    assert.deepEqual(readSketchStore("bukan json"), { sketches: [], openId: null });
  });
});
import { wbsLevel } from "./schedule";
test("level WBS mengikuti jumlah segmen nomor", () => {
  assert.deepEqual(["1", "1.1", "1.1.1", "1.1.1.1"].map(wbsLevel), [1, 2, 3, 4]);
});
