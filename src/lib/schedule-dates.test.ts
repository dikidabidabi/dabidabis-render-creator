import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fillScheduleDates, type ScheduleDateField } from "./schedule-dates";
import type { ScheduleTask } from "./schedule";
const task: ScheduleTask = { id: "a", wbs: "1.1", title: "A", owner: "", start: "2026-10-01", due: "2026-10-30", status: "belum", component: "", color: "lavender", stage: false, checks: [] };
for (const field of ["start", "due", "actualStart", "actualFinish"] as ScheduleDateField[]) test(`fill handle ${field} hanya mengisi kolom dan baris pilihan`, () => {
  const tasks = [task, { ...task, id: "b" }, { ...task, id: "c" }];
  const result = fillScheduleDates(tasks, ["a", "b"], field, "2026-10-15");
  assert.equal(result[1]?.[field], "2026-10-15");
  assert.equal(result[2], tasks[2]);
  for (const other of ["start", "due", "actualStart", "actualFinish"] as ScheduleDateField[]) if (other !== field) assert.equal(result[1]?.[other], tasks[1]?.[other]);
});
test("rentang tidak valid ditolak sekaligus, tanggal predecessor tidak diam-diam ditimpa", () => {
  assert.throws(() => fillScheduleDates([task], ["a"], "due", "2026-09-30"));
  assert.throws(() => fillScheduleDates([{ ...task, actualStart: "2026-10-20" }], ["a"], "actualFinish", "2026-10-15"));
  assert.throws(() => fillScheduleDates([{ ...task, predecessor: { taskId: "b", type: "FS" } }], ["a"], "start", "2026-10-15"));
});