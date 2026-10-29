import { addDays, format, parseISO } from "date-fns";
import { scheduleDuration, type ScheduleTask } from "./schedule";

const code = (task: ScheduleTask) => task.wbs.trim().replace(/\.+$/, "");
const parentCode = (wbs: string) => wbs.slice(0, wbs.lastIndexOf("."));
export const isWeightRoot = (task: ScheduleTask) => /^\d+$/.test(code(task));

/** Derive weights from all immediate siblings, including folded rows. */
export function scheduleWeights(tasks: ScheduleTask[]): Map<string, number> {
  const byCode = new Map(tasks.map((task) => [code(task), task]));
  const counts = new Map<string, number>();
  tasks.forEach((task) => {
    const wbs = code(task);
    if (wbs.includes(".")) counts.set(parentCode(wbs), (counts.get(parentCode(wbs)) ?? 0) + 1);
  });
  const weights = new Map<string, number>();
  function resolve(task: ScheduleTask): number {
    const cached = weights.get(task.id);
    if (cached !== undefined) return cached;
    const wbs = code(task);
    const parent = wbs.includes(".") ? byCode.get(parentCode(wbs)) : undefined;
    const weight = isWeightRoot(task)
      ? (Number.isFinite(task.weight) ? Math.max(0, Math.min(100, task.weight ?? 0)) : 0)
      : parent ? resolve(parent) / (counts.get(code(parent)) ?? 1) : 0;
    weights.set(task.id, weight);
    return weight;
  }
  tasks.forEach(resolve);
  return weights;
}

/** Seven-day periods from task start; the last partial week retains only its day share. */
export function weeklyTaskWeights(task: ScheduleTask, weight: number) {
  const duration = scheduleDuration(task.start, task.due);
  if (!duration) return [{ start: task.start, days: 1, weight }];
  return Array.from({ length: Math.ceil(duration / 7) }, (_, index) => {
    const days = Math.min(7, duration - index * 7);
    return { start: format(addDays(parseISO(task.start), index * 7), "yyyy-MM-dd"), days, weight: weight * days / duration };
  });
}

export const formatScheduleWeight = (weight: number) => `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(weight)}%`;