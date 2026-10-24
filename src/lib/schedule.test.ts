import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { upsertTaskProgress, normalizeSchedule, normalizeScheduleStore, readSketchStore, scheduleDue, scheduleDuration, scheduleProgress, totalScheduleProgress, parsePredecessor, predecessorText, resolveScheduleDependencies, nextTaskNumber, type ScheduleTask } from "./schedule";

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
test("progres bertanggal tersimpan per pekerjaan, mengganti tanggal sama dan menolak di luar 0–100", () => {
  let entries = upsertTaskProgress([], { date: "2026-10-12", actual: 25 });
  entries = upsertTaskProgress(entries, { date: "2026-10-06", actual: 10 });
  entries = upsertTaskProgress(entries, { date: "2026-10-12", actual: 60 });
  const saved = normalizeSchedule([{ ...task, progressEntries: entries }])[0];
  assert.deepEqual(saved?.progressEntries, [{ date: "2026-10-06", actual: 10 }, { date: "2026-10-12", actual: 60 }]);
  if (!saved) throw new Error("Pekerjaan tidak terbaca");
  assert.equal(scheduleProgress(saved, [saved], "2026-10-10"), 10);
  assert.equal(scheduleProgress(saved, [saved], "2026-10-12"), 60);
  for (const actual of [-1, 101, NaN]) assert.throws(() => upsertTaskProgress(entries, { date: "2026-10-12", actual }));
  assert.throws(() => upsertTaskProgress(entries, { date: "2026-02-30", actual: 40 }));
});
test("level WBS mengikuti jumlah segmen nomor", () => {
  assert.deepEqual(["1", "1.1", "1.1.1", "1.1.1.1"].map(wbsLevel), [1, 2, 3, 4]);
});

const previous: ScheduleTask = { ...task, id: "A", taskNumber: 2, start: "2026-10-10", due: "2026-10-20" };
const successor: ScheduleTask = { ...task, id: "B", taskNumber: 3, start: "2026-10-01", due: "2026-10-04" };
describe("Hubungan predecessor", () => {
  test("2 dan 2FS memakai Finish to Start secara default", () => {
    for (const text of ["2", "2FS"]) {
      const p = parsePredecessor(text, successor, [previous, successor]);
      assert.deepEqual(p, { taskId: "A", type: "FS" });
      const result = resolveScheduleDependencies([previous, { ...successor, predecessor: p }])[1];
      assert.equal(result?.start, "2026-10-20");
      assert.equal(result?.due, "2026-10-23");
    }
  });
  test("2SS menyamakan tanggal mulai", () => {
    const result = resolveScheduleDependencies([previous, { ...successor, predecessor: parsePredecessor("2SS", successor, [previous]) }])[1];
    assert.equal(result?.start, "2026-10-10");
    assert.equal(result?.due, "2026-10-13");
  });
  test("2FF menyamakan tanggal selesai", () => {
    const result = resolveScheduleDependencies([previous, { ...successor, predecessor: parsePredecessor("2FF", successor, [previous]) }])[1];
    assert.equal(result?.start, "2026-10-17");
    assert.equal(result?.due, "2026-10-20");
  });
  test("2SF menghubungkan mulai pendahulu dengan selesai penerus", () => {
    const result = resolveScheduleDependencies([previous, { ...successor, predecessor: parsePredecessor("2SF", successor, [previous]) }])[1];
    assert.equal(result?.start, "2026-10-07");
    assert.equal(result?.due, "2026-10-10");
  });
  test("perubahan pendahulu merambat melalui rantai dan mempertahankan durasi", () => {
    const b = { ...successor, predecessor: { taskId: "A", type: "FS" as const } };
    const c = { ...successor, id: "C", taskNumber: 4, predecessor: { taskId: "B", type: "FS" as const } };
    const result = resolveScheduleDependencies([c, b, { ...previous, due: "2026-10-25" }]);
    assert.equal(result[0]?.start, "2026-10-28");
    assert.equal(result[0]?.due, "2026-10-31");
    assert.equal(result[1]?.start, "2026-10-25");
  });
  test("ID tidak dikenal, diri sendiri, format salah, siklus dan hapus pendahulu ditolak", () => {
    for (const text of ["99", "3", "2XX", "1.1FS"]) assert.throws(() => parsePredecessor(text, successor, [previous, successor]));
    assert.throws(() => resolveScheduleDependencies([{ ...previous, predecessor: { taskId: "B", type: "FS" } }, { ...successor, predecessor: { taskId: "A", type: "SS" } }]), /siklus/);
    assert.throws(() => resolveScheduleDependencies([{ ...successor, predecessor: { taskId: "A", type: "FS" } }]), /dihapus/);
  });
  test("tautan tetap mengikuti ID meski WBS diubah dan hubungan bisa dilepas", () => {
    const b = { ...successor, predecessor: parsePredecessor("2FF", successor, [previous]) };
    const list = normalizeSchedule([{ ...previous, wbs: "4.3" }, b]);
    assert.equal(predecessorText(list[1] as ScheduleTask, list), "2FF");
    assert.equal(nextTaskNumber(list), 4);
    assert.equal(parsePredecessor("", successor, list), undefined);
    assert.deepEqual(normalizeSchedule([task, { ...task, id: "old2" }]).map((t) => t.taskNumber), [1, 2]);
  });
});
