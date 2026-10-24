import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { scheduleDuration, scheduleProgress, type ScheduleTask } from "./schedule";

export const SCHEDULE_VIEW_KEY = "dabidabis_jadwal_view_v1";
export type ProgressObservation = { date: string; actual: number };
export type ScheduleView = { collapsed: string[]; cpm: boolean; slack: number; observations: ProgressObservation[] };
export const DEFAULT_SCHEDULE_VIEW: ScheduleView = { collapsed: [], cpm: false, slack: 0, observations: [] };

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
    switch (target.predecessor?.type) {
      case "SS": return 0;
      case "FF": return duration(source) - duration(target);
      case "SF": return -duration(target);
      default: return duration(source);
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
  const finish = Math.max(0, ...tasks.map((task) => forward(task) + duration(task)));
  const latest = new Map<string, number>();
  function backward(task: ScheduleTask): number {
    const cached = latest.get(task.id);
    if (cached !== undefined) return cached;
    const children = tasks.filter((next) => next.predecessor?.taskId === task.id);
    const value = Math.min(finish - duration(task), ...children.map((next) => backward(next) - lag(task, next)));
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

export function weightedProgress(tasks: ScheduleTask[]) {
  const leaves = scheduleLeaves(tasks);
  const weight = (task: ScheduleTask) => Math.max(1, scheduleDuration(task.start, task.due));
  const total = leaves.reduce((sum, task) => sum + weight(task), 0);
  return total ? leaves.reduce((sum, task) => sum + weight(task) * scheduleProgress(task, tasks), 0) / total : 0;
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