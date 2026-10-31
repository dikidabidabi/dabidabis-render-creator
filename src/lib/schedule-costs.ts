import type { ScheduleTask } from "./schedule";

const code = (task: ScheduleTask) => task.wbs.trim().replace(/\.+$/, "");
const parentCode = (value: string) => value.includes(".") ? value.slice(0, value.lastIndexOf(".")) : "";
export const validScheduleCost = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export const hasProjectCost = (value: unknown): value is number => validScheduleCost(value) && value > 0;

/** Only explicit task costs persist; derived shares are recalculated for every sibling group. */
export function scheduleCosts(tasks: ScheduleTask[], projectCost?: number): Map<string, number> {
  const groups = new Map<string, ScheduleTask[]>();
  for (const task of tasks) {
    const key = parentCode(code(task));
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const result = new Map<string, number>();
  function allocate(key: string, budget?: number) {
    const siblings = groups.get(key) ?? [];
    const manual = siblings.filter((task) => validScheduleCost(task.cost));
    const totalManual = manual.reduce((sum, task) => sum + (task.cost ?? 0), 0);
    if (budget !== undefined && totalManual > budget + 0.005) {
      throw new Error(key ? `Biaya manual rincian WBS ${key} melebihi biaya induk.` : "Biaya manual pekerjaan utama melebihi biaya proyek.");
    }
    const automatic = siblings.length - manual.length;
    const share = budget === undefined || !automatic ? undefined : Math.max(0, budget - totalManual) / automatic;
    for (const task of siblings) {
      const value = validScheduleCost(task.cost) ? task.cost : share;
      if (value !== undefined) result.set(task.id, value);
      allocate(code(task), value);
    }
  }
  allocate("", hasProjectCost(projectCost) ? projectCost : undefined);
  return result;
}

export function editScheduleCost(tasks: ScheduleTask[], id: string, cost: number | undefined, projectCost?: number) {
  if (cost !== undefined && !validScheduleCost(cost)) throw new Error("Biaya harus berupa angka positif atau nol.");
  const next = tasks.map((task) => task.id === id ? { ...task, cost } : task);
  scheduleCosts(next, projectCost);
  return next;
}

export const formatScheduleCost = (cost: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 }).format(cost);