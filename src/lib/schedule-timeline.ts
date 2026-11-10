import { addDays, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import type { ScheduleTask } from "./schedule";

/** Rentang Gantt dimulai tepat dari tanggal terawal yang diinput (bukan hari
 *  ini), sehingga jadwal yang dimulai berbulan-bulan lagi tidak diawali jeda
 *  kosong. `inputStart`/`inputEnd` adalah rentang tanggal yang benar-benar
 *  diinput dan menentukan apakah garis hari ini ditampilkan. */
export function scheduleTimelineRange(tasks: ScheduleTask[], today: Date) {
  const starts = tasks.flatMap((task) => [task.start, ...(task.actualStart ? [task.actualStart] : [])]).filter(Boolean).sort();
  const ends = tasks.flatMap((task) => [task.due, ...(task.actualFinish ? [task.actualFinish] : []), ...(task.progressEntries ?? []).filter((entry) => entry.actual >= 100).map((entry) => entry.date)]).filter(Boolean).sort();
  if (!starts.length) {
    const current = format(today, "yyyy-MM-dd");
    return { start: startOfMonth(today), end: endOfMonth(addDays(today, 14)), inputStart: current, inputEnd: current, hasInput: false };
  }
  const inputStart = starts[0];
  const inputEnd = [ends.at(-1) ?? inputStart, starts.at(-1) ?? inputStart].sort().at(-1) ?? inputStart;
  return { start: parseISO(inputStart), end: endOfMonth(addDays(parseISO(inputEnd), 14)), inputStart, inputEnd, hasInput: true };
}

/** Garis biru hari ini hanya muncul bila hari ini masuk rentang jadwal yang diinput. */
export function todayInTimeline(range: { inputStart: string; inputEnd: string; hasInput: boolean }, today: Date) {
  const current = format(today, "yyyy-MM-dd");
  return range.hasInput && current >= range.inputStart && current <= range.inputEnd;
}

export type ScheduleColumnKey = "id" | "wbs" | "title" | "owner" | "start" | "due" | "duration" | "predecessor" | "percent" | "status" | "component" | "actualStart" | "actualFinish" | "progress" | "cost" | "weight" | "actions";
export type ScheduleColumn = { key: ScheduleColumnKey; label: string; width: number; hideable: boolean };

const COLUMNS: ScheduleColumn[] = [
  { key: "id", label: "ID", width: 45, hideable: false },
  { key: "wbs", label: "WBS", width: 95, hideable: false },
  { key: "title", label: "Judul pekerjaan", width: 260, hideable: false },
  { key: "owner", label: "Penanggung jawab", width: 125, hideable: true },
  { key: "start", label: "Tanggal mulai", width: 100, hideable: true },
  { key: "due", label: "Tenggat", width: 100, hideable: true },
  { key: "duration", label: "Durasi", width: 70, hideable: true },
  { key: "predecessor", label: "Predecessor", width: 125, hideable: true },
  { key: "percent", label: "% Selesai", width: 75, hideable: true },
  { key: "status", label: "Status", width: 110, hideable: true },
  { key: "component", label: "Komponen", width: 140, hideable: true },
  { key: "actualStart", label: "Aktual mulai", width: 100, hideable: true },
  { key: "actualFinish", label: "Aktual selesai", width: 100, hideable: true },
  { key: "progress", label: "Progres", width: 110, hideable: true },
  { key: "cost", label: "Biaya (Rp)", width: 155, hideable: true },
  { key: "weight", label: "Bobot", width: 95, hideable: true },
  { key: "actions", label: "", width: 64, hideable: false },
];

/** Kolom yang tersedia (Biaya hanya saat ceklis Biaya aktif). */
export function availableScheduleColumns(costs: boolean) {
  return COLUMNS.filter((column) => costs || column.key !== "cost");
}

/** Kolom yang tampil: mulai dari Penanggung jawab ke kanan dapat disembunyikan. */
export function visibleScheduleColumns(costs: boolean, hidden: readonly string[] = []) {
  return availableScheduleColumns(costs).filter((column) => !column.hideable || !hidden.includes(column.key));
}

export function toggleHiddenColumn(hidden: readonly string[] = [], key: ScheduleColumnKey) {
  const column = COLUMNS.find((item) => item.key === key);
  if (!column?.hideable) return [...hidden];
  return hidden.includes(key) ? hidden.filter((item) => item !== key) : [...hidden, key];
}
