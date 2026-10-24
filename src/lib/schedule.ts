import { addDays, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";

export const SCHEDULE_KEY = "dabidabis_jadwal_v1";
export const SKETCH_STORE_KEY = "dabidabis_sketch_v2";
export const SCHEDULE_COLORS = ["stage", "lavender", "green", "yellow", "neutral"] as const;
export type ScheduleColor = (typeof SCHEDULE_COLORS)[number];
export const SCHEDULE_STATUSES = ["belum", "berjalan", "berisiko", "tertunda", "selesai"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export type ScheduleCheck = { id: string; title: string; done: boolean };
export type ScheduleTask = {
  id: string;
  wbs: string;
  title: string;
  owner: string;
  start: string;
  due: string;
  status: ScheduleStatus;
  component: string;
  color: ScheduleColor;
  stage: boolean;
  checks: ScheduleCheck[];
};

export function validScheduleDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value)) && format(parseISO(value), "yyyy-MM-dd") === value;
}

// Durasi adalah selisih hari kalender, sesuai contoh 2–30 September = 28 hari.
export function scheduleDuration(start: string, due: string): number {
  if (!validScheduleDate(start) || !validScheduleDate(due)) return 0;
  return Math.max(0, differenceInCalendarDays(parseISO(due), parseISO(start)));
}

export function scheduleDue(start: string, duration: number): string {
  if (!validScheduleDate(start)) return "";
  return format(addDays(parseISO(start), Math.max(0, Math.trunc(duration) || 0)), "yyyy-MM-dd");
}

export function taskChecks(task: ScheduleTask, tasks: ScheduleTask[]): ScheduleCheck[] {
  if (!task.stage || !task.wbs.trim()) return task.checks;
  const children = tasks.filter((child) => child.id !== task.id && !child.stage && child.wbs.startsWith(`${task.wbs}.`));
  return children.length ? children.flatMap((child) => child.checks) : task.checks;
}

export function scheduleProgress(task: ScheduleTask, tasks: ScheduleTask[]): number {
  const checks = taskChecks(task, tasks);
  return checks.length ? Math.round(checks.filter((check) => check.done).length / checks.length * 1000) / 10 : 0;
}

export function totalScheduleProgress(tasks: ScheduleTask[]): number {
  // Jangan hitung ulang ceklis anak yang sudah tercakup dalam tahap.
  const checks = tasks.filter((task) => !task.stage || !tasks.some((child) => !child.stage && child.wbs.startsWith(`${task.wbs}.`))).flatMap((task) => task.checks);
  return checks.length ? Math.round(checks.filter((check) => check.done).length / checks.length * 1000) / 10 : 0;
}

export function normalizeSchedule(value: unknown): ScheduleTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ScheduleTask[] => {
    if (!item || typeof item !== "object") return [];
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || typeof t.title !== "string" || typeof t.start !== "string" || typeof t.due !== "string" || !validScheduleDate(t.start) || !validScheduleDate(t.due) || t.due < t.start) return [];
    const checks = Array.isArray(t.checks) ? t.checks.flatMap((entry): ScheduleCheck[] => {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.title !== "string") return [];
      return [{ id: entry.id, title: entry.title, done: entry.done === true }];
    }) : [];
    return [{ id: t.id, title: t.title, wbs: typeof t.wbs === "string" ? t.wbs : "", owner: typeof t.owner === "string" ? t.owner : "", start: t.start, due: t.due, status: SCHEDULE_STATUSES.includes(t.status as ScheduleStatus) ? t.status as ScheduleStatus : "belum", component: typeof t.component === "string" ? t.component : "", color: SCHEDULE_COLORS.includes(t.color as ScheduleColor) ? t.color as ScheduleColor : "lavender", stage: t.stage === true, checks }];
  });
}

export type SketchRef = { id: string; title: string };

/** Daftar sketsa dari store Sketsa, beserta sketsa yang sedang dibuka. */
export function readSketchStore(raw: string | null): { sketches: SketchRef[]; openId: string | null } {
  if (!raw) return { sketches: [], openId: null };
  try {
    const parsed = JSON.parse(raw) as { sketches?: unknown; openId?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.sketches)) return { sketches: [], openId: null };
    const sketches = parsed.sketches.flatMap((item): SketchRef[] => {
      if (!item || typeof item !== "object") return [];
      const s = item as Record<string, unknown>;
      if (typeof s.id !== "string" || !s.id) return [];
      const title = typeof s.title === "string" && s.title.trim() ? s.title.trim() : "Sketsa tanpa judul";
      return [{ id: s.id, title }];
    });
    return { sketches, openId: typeof parsed.openId === "string" ? parsed.openId : null };
  } catch {
    return { sketches: [], openId: null };
  }
}

export type ScheduleStore = Record<string, ScheduleTask[]>;

/**
 * Store jadwal berbentuk map per sketsa `{ [sketchId]: ScheduleTask[] }`.
 * Format lama (satu daftar untuk semua) dipindahkan ke sketsa aktif.
 */
export function normalizeScheduleStore(value: unknown, fallbackSketchId?: string | null): ScheduleStore {
  if (Array.isArray(value)) {
    const tasks = normalizeSchedule(value);
    return tasks.length && fallbackSketchId ? { [fallbackSketchId]: tasks } : {};
  }
  if (!value || typeof value !== "object") return {};
  const out: ScheduleStore = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const tasks = normalizeSchedule(entry);
    if (tasks.length) out[key] = tasks;
  }
  return out;
}