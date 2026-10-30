import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { scheduleDuration, scheduleProgress, type ScheduleTask } from "./schedule";

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
/** Realized percent of a task on a date: dated entries when present, else current checklist from today on. */
export function realizedProgressAt(task: ScheduleTask, tasks: ScheduleTask[], date: string, today: string) {
  const dated = tasks.some((item) => item.progressEntries?.length);
  if (dated) return scheduleProgress(task, tasks, date);
  return date >= today ? scheduleProgress(task, tasks, today) : 0;
}

/** Weekly realized weight = plan weight × progress gained that week, on the plan's 7-day grid. */
export function weeklyActualWeights(task: ScheduleTask, weight: number, tasks: ScheduleTask[], today: string) {
  const origin = parseISO(task.start);
  const earliest = [task.start, task.actualStart, ...(task.progressEntries ?? []).map((entry) => entry.date)].filter(Boolean).sort()[0] as string;
  const first = Math.min(0, Math.floor(differenceInCalendarDays(parseISO(earliest), origin) / 7));
  const out: { start: string; days: number; weight: number; progress: number }[] = [];
  let previous = 0;
  for (let index = first; index < first + 520; index++) {
    const weekStart = addDays(origin, index * 7);
    const start = format(weekStart, "yyyy-MM-dd");
    if (start > today) break;
    const end = format(addDays(weekStart, 6), "yyyy-MM-dd");
    const progress = realizedProgressAt(task, tasks, end < today ? end : today, today);
    const gained = progress - previous;
    if (gained > 0) out.push({ start, days: 7, weight: weight * gained / 100, progress: gained });
    previous = Math.max(previous, progress);
    if (previous >= 100) break;
  }
  return out;
}

/** Weight-based S-curve: plan = Σ weight × elapsed share; realization = Σ weight × realized percent. */
export function weightedPlanAt(tasks: ScheduleTask[], weights: Map<string, number>, date: string) {
  return leavesOf(tasks).reduce((sum, task) => {
    const duration = scheduleDuration(task.start, task.due);
    const elapsed = differenceInCalendarDays(parseISO(date), parseISO(task.start));
    const fraction = duration ? Math.max(0, Math.min(1, elapsed / duration)) : date >= task.due ? 1 : 0;
    return sum + (weights.get(task.id) ?? 0) * fraction;
  }, 0);
}

export function weightedActualAt(tasks: ScheduleTask[], weights: Map<string, number>, date: string, today: string) {
  return leavesOf(tasks).reduce((sum, task) => sum + (weights.get(task.id) ?? 0) * realizedProgressAt(task, tasks, date, today) / 100, 0);
}

export const hasScheduleWeights = (weights: Map<string, number>) => [...weights.values()].some((value) => value > 0);

export const WEEKLY_SUMMARY_ROWS = [
  { key: "plan", label: "Bobot rencana" },
  { key: "planCumulative", label: "Akumulasi bobot rencana" },
  { key: "actual", label: "Bobot realisasi" },
  { key: "actualCumulative", label: "Akumulasi bobot realisasi" },
] as const;

/** Same leaf allocations as the curve, with duration fallback for unweighted schedules. */
export function curveAllocationWeights(tasks: ScheduleTask[], weights: Map<string, number>) {
  if (hasScheduleWeights(weights)) return weights;
  const leaves = leavesOf(tasks);
  const total = leaves.reduce((sum, task) => sum + Math.max(1, scheduleDuration(task.start, task.due)), 0);
  return new Map(leaves.map((task) => [task.id, total ? Math.max(1, scheduleDuration(task.start, task.due)) * 100 / total : 0]));
}

/** Calendar-week totals; parent rows never double-count their leaf work. */
export function weeklyScheduleSummary(tasks: ScheduleTask[], weights: Map<string, number>, weeks: Date[], today: string) {
  const allocations = curveAllocationWeights(tasks, weights);
  const clean = (value: number) => Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e10) / 1e10;
  return weeks.map((week) => {
    const start = format(week, "yyyy-MM-dd");
    const before = format(addDays(week, -1), "yyyy-MM-dd");
    const next = format(addDays(week, 7), "yyyy-MM-dd");
    const end = format(addDays(week, 6), "yyyy-MM-dd");
    const planCumulative = weightedPlanAt(tasks, allocations, next);
    const actualCumulative = start > today ? null : weightedActualAt(tasks, allocations, end < today ? end : today, today);
    return { start, plan: clean(planCumulative - weightedPlanAt(tasks, allocations, start)), planCumulative: clean(planCumulative),
      actual: actualCumulative === null ? null : clean(actualCumulative - weightedActualAt(tasks, allocations, before, today)),
      actualCumulative: actualCumulative === null ? null : clean(actualCumulative) };
  });
}

function leavesOf(tasks: ScheduleTask[]) {
  return tasks.filter((task) => !tasks.some((child) => child.id !== task.id && child.wbs.startsWith(`${code(task)}.`)));
}
