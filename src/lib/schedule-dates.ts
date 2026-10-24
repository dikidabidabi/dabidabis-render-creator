import { validScheduleDate, type ScheduleTask } from "./schedule";

export const SCHEDULE_DATE_LABELS = { start: "Tanggal mulai", due: "Tenggat", actualStart: "Aktual mulai", actualFinish: "Aktual selesai" } as const;
export type ScheduleDateField = keyof typeof SCHEDULE_DATE_LABELS;

/** Atomic column fill: validate every target before the caller persists anything. */
export function fillScheduleDates(tasks: ScheduleTask[], ids: string[], field: ScheduleDateField, value: string): ScheduleTask[] {
  if (value && !validScheduleDate(value)) throw new Error("Tanggal tidak valid.");
  if (!value && (field === "start" || field === "due")) throw new Error("Tanggal rencana wajib diisi.");
  const selected = new Set(ids);
  return tasks.map((task) => {
    if (!selected.has(task.id)) return task;
    if ((field === "start" || field === "due") && task.predecessor) throw new Error(`Tanggal ${task.title} mengikuti predecessor. Ubah acuan atau offsetnya terlebih dahulu.`);
    const next = { ...task, [field]: value || undefined };
    if (next.due < next.start) throw new Error(`Tenggat ${task.title} tidak boleh sebelum tanggal mulai.`);
    if (next.actualStart && next.actualFinish && next.actualFinish < next.actualStart) throw new Error(`Aktual selesai ${task.title} tidak boleh sebelum aktual mulai.`);
    return next;
  });
}