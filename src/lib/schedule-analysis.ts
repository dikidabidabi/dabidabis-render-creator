import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { scheduleDuration, scheduleProgress, taskProgressAt, type ScheduleTask } from "./schedule";

export const SCHEDULE_VIEW_KEY = "dabidabis_jadwal_view_v1";
export type ProgressObservation = { date: string; actual: number; note?: string };
export type ScheduleView = { collapsed: string[]; cpm: boolean; slack: number; observations: ProgressObservation[] };
export const DEFAULT_SCHEDULE_VIEW: ScheduleView = { collapsed: [], cpm: false, slack: 0, observations: [] };

export function normalizeScheduleViews(value: unknown): Record<string, ScheduleView> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Partial<ScheduleView>;
    return [[id, { collapsed: Array.isArray(item.collapsed) ? item.collapsed.filter((id) => typeof id === "string") : [], cpm: item.cpm === true, slack: typeof item.slack === "number" && Number.isFinite(item.slack) ? Math.max(0, Math.trunc(item.slack)) : 0, observations: Array.isArray(item.observations) ? item.observations.filter((point) => point && /^\d{4}-\d{2}-\d{2}$/.test(point.date) && typeof point.actual === "number" && Number.isFinite(point.actual) && point.actual >= 0 && point.actual <= 100).sort((a, b) => a.date.localeCompare(b.date)) : [] }]];
  }));
}

export function descendants(task: ScheduleTask, tasks: ScheduleTask[]) {
  const prefix = task.wbs.trim().replace(/\.+$/, "") + ".";
  return tasks.filter((child) => child.id !== task.id && child.wbs.trim().startsWith(prefix));
}

export function visibleSchedule(tasks: ScheduleTask[], collapsed: string[]) {
  const hidden = new Set(tasks.filter((task) => collapsed.includes(task.id)).flatMap((task) => descendants(task, tasks).map((child) => child.id)));
  return tasks.filter((task) => !hidden.has(task.id));
}

export function scheduleLeaves(tasks: ScheduleTask[]) {
  return tasks.filter((task) => !descendants(task, tasks).length);
}

/** Generalized CPM constraints: successor start >= predecessor start + edge lag. */
export function criticalPath(tasks: ScheduleTask[], threshold = 0) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const early = new Map<string, number>();
  const visiting = new Set<string>();
  const origin = tasks.map((task) => task.start).sort()[0];
  if (!origin) return { critical: new Set<string>(), floats: new Map<string, number>(), duration: 0 };
  const day = (date: string) => differenceInCalendarDays(parseISO(date), parseISO(origin));
  const duration = (task: ScheduleTask) => scheduleDuration(task.start, task.due);
  const lag = (source: ScheduleTask, target: ScheduleTask) => {
    const offset = target.predecessor?.lag ?? 0;
    switch (target.predecessor?.type) {
      case "SS": return offset;
      case "FF": return duration(source) - duration(target) + offset;
      case "SF": return -duration(target) + offset;
      default: return duration(source) + offset;
    }
  };
  function forward(task: ScheduleTask): number {
    const cached = early.get(task.id);
    if (cached !== undefined) return cached;
    if (visiting.has(task.id)) throw new Error("Hubungan pekerjaan membentuk siklus.");
    visiting.add(task.id);
    const source = task.predecessor ? byId.get(task.predecessor.taskId) : undefined;
    const start = Math.max(day(task.start), source ? forward(source) + lag(source, task) : day(task.start));
    early.set(task.id, start);
    visiting.delete(task.id);
    return start;
  }
  tasks.forEach(forward);
  const leafIds = new Set(scheduleLeaves(tasks).map((task) => task.id));
  const finish = Math.max(0, ...tasks.filter((task) => leafIds.has(task.id)).map((task) => forward(task) + duration(task)));
  const latest = new Map<string, number>();
  function backward(task: ScheduleTask): number {
    const cached = latest.get(task.id);
    if (cached !== undefined) return cached;
    const children = tasks.filter((next) => next.predecessor?.taskId === task.id);
    const value = Math.min(leafIds.has(task.id) ? finish - duration(task) : Infinity, ...children.map((next) => backward(next) - lag(task, next)));
    latest.set(task.id, value);
    return value;
  }
  const floats = new Map(tasks.map((task) => [task.id, Math.max(0, backward(task) - forward(task))]));
  const critical = new Set(tasks.filter((task) => (floats.get(task.id) ?? Infinity) <= Math.max(0, threshold)).map((task) => task.id));
  // A summary is highlighted only when at least one underlying work item is critical.
  tasks.forEach((task) => {
    const children = descendants(task, tasks);
    if (children.length) {
      if (children.some((child) => critical.has(child.id))) critical.add(task.id);
      else critical.delete(task.id);
    }
  });
  return { critical, floats, duration: finish };
}

export function weightedProgress(tasks: ScheduleTask[], date = format(new Date(), "yyyy-MM-dd")) {
  const leaves = scheduleLeaves(tasks);
  const weight = (task: ScheduleTask) => Math.max(1, scheduleDuration(task.start, task.due));
  const total = leaves.reduce((sum, task) => sum + weight(task), 0);
  return total ? leaves.reduce((sum, task) => sum + weight(task) * scheduleProgress(task, tasks, date), 0) / total : 0;
}

/** Historical realization uses dated leaf records, never today's checklist for past dates. */
export function actualProgressAt(tasks: ScheduleTask[], date: string): number | null {
  const leaves = scheduleLeaves(tasks);
  if (!leaves.some((task) => taskProgressAt(task, date) !== null)) return null;
  const weight = (task: ScheduleTask) => Math.max(1, scheduleDuration(task.start, task.due));
  const total = leaves.reduce((sum, task) => sum + weight(task), 0);
  return total ? leaves.reduce((sum, task) => sum + weight(task) * (taskProgressAt(task, date) ?? 0), 0) / total : null;
}

/**
 * Rentang keterlambatan: dari tenggat hingga tanggal progres pertama mencapai 100%,
 * atau hingga hari ini bila belum 100%. Tanpa catatan bertanggal, progres 100%
 * dianggap selesai tepat waktu karena tanggal selesainya tidak diketahui.
 */
export function delayBarRange(task: ScheduleTask, today: string, currentProgress?: number): { start: string; end: string } | null {
  const completion = task.actualFinish ?? (task.progressEntries ?? []).filter((point) => point.actual >= 100).map((point) => point.date).sort()[0];
  if (!completion && currentProgress !== undefined && currentProgress >= 100) return null;
  const end = completion ?? today;
  return end > task.due ? { start: task.due, end } : null;
}

/** Explicit actual dates take priority; unfinished work tracks today. Split at planned due. */
export function actualBarRanges(task: ScheduleTask, today: string, currentProgress?: number) {
  if (!task.actualStart) return [];
  const completion = task.actualFinish ?? (task.progressEntries ?? []).filter((point) => point.actual >= 100).map((point) => point.date).sort()[0];
  const end = completion ?? (currentProgress !== undefined && currentProgress >= 100 ? (task.progressEntries ?? []).map((point) => point.date).sort().at(-1) ?? task.actualStart : today);
  if (end < task.actualStart) return [];
  const ranges: { start: string; end: string; late: boolean }[] = [];
  if (task.actualStart <= task.due) ranges.push({ start: task.actualStart, end: end < task.due ? end : task.due, late: false });
  if (end > task.due) ranges.push({ start: task.actualStart > task.due ? task.actualStart : task.due, end, late: true });
  return ranges;
}

export function plannedProgress(tasks: ScheduleTask[], date: string) {
  const leaves = scheduleLeaves(tasks);
  const total = leaves.reduce((sum, task) => sum + Math.max(1, scheduleDuration(task.start, task.due)), 0);
  return total ? leaves.reduce((sum, task) => {
    const duration = scheduleDuration(task.start, task.due);
    const elapsed = differenceInCalendarDays(parseISO(date), parseISO(task.start));
    const fraction = duration ? Math.max(0, Math.min(1, elapsed / duration)) : date >= task.due ? 1 : 0;
    return sum + Math.max(1, duration) * fraction * 100;
  }, 0) / total : 0;
}

export function recordObservation(observations: ProgressObservation[], tasks: ScheduleTask[], today: Date) {
  const date = format(today, "yyyy-MM-dd");
  return [...observations.filter((point) => point.date !== date), { date, actual: weightedProgress(tasks) }].sort((a, b) => a.date.localeCompare(b.date));
}

/** Pengisian progres manual bertanggal; tanggal sama menggantikan entri sebelumnya. */
export function upsertObservation(observations: ProgressObservation[], entry: ProgressObservation) {
  const actual = Math.max(0, Math.min(100, entry.actual));
  const note = entry.note?.trim() || undefined;
  return [...observations.filter((point) => point.date !== entry.date), { date: entry.date, actual, ...(note ? { note } : {}) }].sort((a, b) => a.date.localeCompare(b.date));
}

export function removeObservation(observations: ProgressObservation[], date: string) {
  return observations.filter((point) => point.date !== date);
}