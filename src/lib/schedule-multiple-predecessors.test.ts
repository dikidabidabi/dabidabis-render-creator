import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseISO } from "date-fns";
import { copyScheduleEntry, normalizeSchedule, parsePredecessors, predecessorText, resolveScheduleDependencies, taskPredecessors, type ScheduleTask } from "./schedule";
import { criticalPath } from "./schedule-analysis";
import { scheduleConnectors } from "./schedule-connectors";
import { fillScheduleDates } from "./schedule-dates";

const task = (n: number, start: string, due: string): ScheduleTask => ({ id: `t${n}`, taskNumber: n, title: `Pekerjaan ${n}`, wbs: `${n}`, start, due, owner: "", component: "", checks: [], stage: false, status: "belum", color: "lavender" });
const sources = [task(2, "2026-10-01", "2026-10-10"), task(3, "2026-10-03", "2026-10-15"), task(4, "2026-10-02", "2026-10-12")];
const target = task(5, "2026-10-01", "2026-10-06");
const resolve = (text: string) => resolveScheduleDependencies([...sources, { ...target, predecessors: parsePredecessors(text, target, sources) }]);

test("2;3;4FS menunggu semua ID selesai dan mempertahankan durasi", () => {
  const tasks = resolve("(2;3;4FS)");
  assert.deepEqual(taskPredecessors(tasks[3]).map((link) => link.type), ["FS", "FS", "FS"]);
  assert.equal(tasks[3].start, "2026-10-15");
  assert.equal(tasks[3].due, "2026-10-20");
});
test("2SS;3FS memenuhi kedua hubungan dengan tanggal paling akhir", () => {
  const tasks = resolve("2SS;3FS");
  assert.equal(tasks[3].start, "2026-10-15");
  assert.equal(predecessorText(tasks[3], tasks), "2SS;3FS");
});
test("2SS+1;3FS-2 menerapkan offset per hubungan", () => {
  const tasks = resolve("2SS+1;3FS-2");
  assert.deepEqual(taskPredecessors(tasks[3]).map((link) => link.lag), [1, -2]);
  assert.equal(tasks[3].start, "2026-10-13");
  assert.equal(tasks[3].due, "2026-10-18");
  const later = resolveScheduleDependencies([{ ...sources[0], start: "2026-10-20", due: "2026-10-29" }, sources[1], sources[2], tasks[3]]);
  assert.equal(later[3].start, "2026-10-21");
});
test("FF dan SF bersama FS memakai batas mulai yang konsisten", () => {
  assert.equal(resolve("2FF+10;3SF+20;4FS")[3].start, "2026-10-18");
});
test("urutan acuan tidak mengubah hasil, acuan dapat menggeser tanggal maju", () => {
  assert.equal(resolve("3FS-2;2SS+1")[3].start, resolve("2SS+1;3FS-2")[3].start);
  const tasks = resolve("2SS+1;3FS-2");
  const relaxed = resolveScheduleDependencies([...tasks.slice(0, 3), { ...tasks[3], predecessors: parsePredecessors("2SS+1", target, sources) }]);
  assert.equal(relaxed[3].start, "2026-10-02");
});
test("validasi semua acuan menolak ID hilang, diri sendiri, token kosong dan siklus acuan kedua", () => {
  for (const text of ["2;999FS", "2;5SS", "2;;3", "2FS;3XX"]) assert.throws(() => parsePredecessors(text, target, [...sources, target]));
  const tasks = resolve("2;3FS");
  assert.throws(() => resolveScheduleDependencies(tasks.filter((item) => item.id !== "t3")), /dihapus/);
  assert.throws(() => resolveScheduleDependencies(tasks.map((item) => item.id === "t3" ? { ...item, predecessors: [{ taskId: "t5", type: "SS" }] } : item)), /siklus/);
});
test("penyimpanan majemuk, kompatibilitas lama dan penghapusan semua acuan", () => {
  const tasks = resolve("2SS+1;3FS-2");
  assert.equal(predecessorText(normalizeSchedule(JSON.parse(JSON.stringify(tasks)))[3], tasks), "2SS+1;3FS-2");
  const legacy = { ...target, predecessor: { taskId: "t2", type: "FS" as const } };
  assert.equal(taskPredecessors(normalizeSchedule([legacy])[0]).length, 1);
  assert.equal(taskPredecessors(normalizeSchedule([{ ...legacy, predecessors: [] }])[0]).length, 0);
  assert.deepEqual(parsePredecessors("", target, sources), []);
});
test("salinan jadwal memiliki array dan acuan independen", () => {
  const tasks = resolve("2SS+1;3FS-2");
  const copy = copyScheduleEntry({ A: tasks }, "A", "B");
  const links = copy.B?.[3]?.predecessors;
  assert.ok(links);
  links[0].lag = 7;
  links.pop();
  assert.equal(tasks[3].predecessors?.[0].lag, 1);
  assert.equal(tasks[3].predecessors?.length, 2);
});
test("CPM memperhitungkan semua hubungan masuk dan keluar", () => {
  const tasks = resolve("2SS+1;3FS-2");
  const result = criticalPath(tasks);
  assert.equal(result.duration, 17);
  assert.equal(result.floats.get("t2"), 8);
  assert.equal(result.floats.get("t3"), 0);
  assert.equal(result.floats.get("t5"), 0);
});
test("kabel majemuk memiliki tipe, offset, dan ID unik untuk setiap acuan", () => {
  const tasks = resolve("2SS+1;3FS-2;4FF");
  const links = scheduleConnectors(tasks, parseISO("2026-10-01"), 6);
  assert.equal(links.length, 3);
  assert.equal(new Set(links.map((link) => link.id)).size, 3);
  assert.deepEqual(links.map((link) => [link.sourceId, link.targetId, link.type, link.lag]), [["t2", "t5", "SS", 1], ["t3", "t5", "FS", -2], ["t4", "t5", "FF", 0]]);
  assert.equal(scheduleConnectors(tasks.filter((item) => item.id !== "t3"), parseISO("2026-10-01"), 22).length, 2);
});
test("tanggal rencana dikunci hanya jika ada hubungan, tanggal aktual tetap dapat diisi", () => {
  const tasks = resolve("2SS;3FS");
  for (const field of ["start", "due"] as const) assert.throws(() => fillScheduleDates(tasks, ["t5"], field, "2026-10-20"), /predecessor/);
  assert.equal(fillScheduleDates(tasks, ["t5"], "actualStart", "2026-10-20")[3].actualStart, "2026-10-20");
  assert.equal(fillScheduleDates([{ ...target, predecessors: [] }], ["t5"], "start", "2026-10-02")[0].start, "2026-10-02");
});