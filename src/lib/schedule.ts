import { addDays, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";

export const SCHEDULE_KEY = "dabidabis_jadwal_v1";
export const SKETCH_STORE_KEY = "dabidabis_sketch_v2";
export const SCHEDULE_COLORS = ["stage", "lavender", "green", "yellow", "neutral"] as const;
export type ScheduleColor = (typeof SCHEDULE_COLORS)[number];
export const SCHEDULE_STATUSES = ["belum", "berjalan", "berisiko", "tertunda", "selesai"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export type ScheduleCheck = { id: string; title: string; done: boolean };
export type TaskProgressEntry = { date: string; actual: number; note?: string };
export const PREDECESSOR_TYPES = ["FS", "SS", "FF", "SF"] as const;
export type PredecessorType = (typeof PREDECESSOR_TYPES)[number];
export type SchedulePredecessor = { taskId: string; type: PredecessorType; lag?: number };
export const PREDECESSOR_LABELS = { FS: "Selesai → Mulai", SS: "Mulai → Mulai", FF: "Selesai → Selesai", SF: "Mulai → Selesai" };
export type ScheduleTask = {
  id: string;
  taskNumber?: number;
  predecessor?: SchedulePredecessor;
  predecessors?: SchedulePredecessor[];
  actualStart?: string;
  actualFinish?: string;
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
  progressEntries?: TaskProgressEntry[];
  weight?: number;
  cost?: number;
};

export function validScheduleDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value)) && format(parseISO(value), "yyyy-MM-dd") === value;
}

/** Read legacy single links and canonical multiple links through one boundary. */
export function taskPredecessors(task: ScheduleTask): SchedulePredecessor[] {
  return task.predecessors ?? (task.predecessor ? [task.predecessor] : []);
}

export function predecessorStartOffset(source: ScheduleTask, target: ScheduleTask, link: SchedulePredecessor): number {
  return (link.type[0] === "F" ? scheduleDuration(source.start, source.due) : 0)
    - (link.type[1] === "F" ? scheduleDuration(target.start, target.due) : 0) + (link.lag ?? 0);
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

export function taskProgressAt(task: ScheduleTask, date: string): number | null {
  const entry = (task.progressEntries ?? []).filter((point) => point.date <= date).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  return entry?.actual ?? null;
}

export function upsertTaskProgress(entries: TaskProgressEntry[], entry: TaskProgressEntry): TaskProgressEntry[] {
  if (!validScheduleDate(entry.date) || !Number.isFinite(entry.actual) || entry.actual < 0 || entry.actual > 100) throw new Error("Isi tanggal yang valid dan progres antara 0–100%.");
  const note = entry.note?.trim();
  return [...entries.filter((point) => point.date !== entry.date), { date: entry.date, actual: entry.actual, ...(note ? { note } : {}) }].sort((a, b) => a.date.localeCompare(b.date));
}

export function scheduleProgress(task: ScheduleTask, tasks: ScheduleTask[], date = format(new Date(), "yyyy-MM-dd")): number {
  const children = tasks.filter((child) => child.id !== task.id && child.wbs.startsWith(`${task.wbs.trim().replace(/\.+$/, "")}.`));
  if (children.length && tasks.some((item) => item.progressEntries?.length)) {
    const leaves = children.filter((child) => !children.some((other) => other.id !== child.id && other.wbs.startsWith(`${child.wbs}.`)));
    const total = leaves.reduce((sum, child) => sum + Math.max(1, scheduleDuration(child.start, child.due)), 0);
    return Math.round(leaves.reduce((sum, child) => sum + Math.max(1, scheduleDuration(child.start, child.due)) * scheduleProgress(child, [], date), 0) / total * 10) / 10;
  }
  if (task.progressEntries?.length) return taskProgressAt(task, date) ?? 0;
  const checks = taskChecks(task, tasks);
  return checks.length ? Math.round(checks.filter((check) => check.done).length / checks.length * 1000) / 10 : 0;
}

export function totalScheduleProgress(tasks: ScheduleTask[]): number {
  if (tasks.some((task) => task.progressEntries?.length)) {
    const leaves = tasks.filter((task) => !tasks.some((child) => child.id !== task.id && child.wbs.startsWith(`${task.wbs.trim().replace(/\.+$/, "")}.`)));
    const total = leaves.reduce((sum, task) => sum + Math.max(1, scheduleDuration(task.start, task.due)), 0);
    return total ? Math.round(leaves.reduce((sum, task) => sum + Math.max(1, scheduleDuration(task.start, task.due)) * scheduleProgress(task, tasks), 0) / total * 10) / 10 : 0;
  }
  // Jangan hitung ulang ceklis anak yang sudah tercakup dalam tahap.
  const checks = tasks.filter((task) => !task.stage || !tasks.some((child) => !child.stage && child.wbs.startsWith(`${task.wbs}.`))).flatMap((task) => task.checks);
  return checks.length ? Math.round(checks.filter((check) => check.done).length / checks.length * 1000) / 10 : 0;
}

export function normalizeSchedule(value: unknown): ScheduleTask[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((item): ScheduleTask[] => {
    if (!item || typeof item !== "object") return [];
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || typeof t.title !== "string" || typeof t.start !== "string" || typeof t.due !== "string" || !validScheduleDate(t.start) || !validScheduleDate(t.due) || t.due < t.start) return [];
    const checks = Array.isArray(t.checks) ? t.checks.flatMap((entry): ScheduleCheck[] => {
      if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.title !== "string") return [];
      return [{ id: entry.id, title: entry.title, done: entry.done === true }];
    }) : [];
    const p = t.predecessor as Record<string, unknown> | undefined;
    const progressEntries = Array.isArray(t.progressEntries) ? t.progressEntries.reduce<TaskProgressEntry[]>((entries, entry) => {
      if (!entry || typeof entry !== "object" || typeof entry.date !== "string" || !validScheduleDate(entry.date) || typeof entry.actual !== "number" || !Number.isFinite(entry.actual) || entry.actual < 0 || entry.actual > 100) return entries;
      return upsertTaskProgress(entries, { date: entry.date, actual: entry.actual, note: typeof entry.note === "string" ? entry.note : undefined });
    }, []) : undefined;
    const predecessor = p && typeof p.taskId === "string" && PREDECESSOR_TYPES.includes(p.type as PredecessorType) ? { taskId: p.taskId, type: p.type as PredecessorType, ...(typeof p.lag === "number" && Number.isSafeInteger(p.lag) && p.lag !== 0 ? { lag: p.lag } : {}) } : undefined;
    const predecessors = Array.isArray(t.predecessors) ? t.predecessors.flatMap((entry): SchedulePredecessor[] => {
      if (!entry || typeof entry !== "object" || typeof entry.taskId !== "string" || !PREDECESSOR_TYPES.includes(entry.type)) return [];
      if (entry.lag !== undefined && !Number.isSafeInteger(entry.lag)) return [];
      return [{ taskId: entry.taskId, type: entry.type, ...(entry.lag ? { lag: entry.lag } : {}) }];
    }) : undefined;
    const actualStart = typeof t.actualStart === "string" && validScheduleDate(t.actualStart) ? t.actualStart : undefined;
    const actualFinish = typeof t.actualFinish === "string" && validScheduleDate(t.actualFinish) && (!actualStart || t.actualFinish >= actualStart) ? t.actualFinish : undefined;
    const weight = typeof t.weight === "number" && Number.isFinite(t.weight) && t.weight >= 0 && t.weight <= 100 ? t.weight : undefined;
    const cost = typeof t.cost === "number" && Number.isFinite(t.cost) && t.cost >= 0 ? t.cost : undefined;
    return [{ id: t.id, taskNumber: typeof t.taskNumber === "number" && Number.isSafeInteger(t.taskNumber) && t.taskNumber > 0 ? t.taskNumber : undefined, ...(predecessors ? { predecessors } : { predecessor }), actualStart, actualFinish, title: t.title, wbs: typeof t.wbs === "string" ? t.wbs : "", owner: typeof t.owner === "string" ? t.owner : "", start: t.start, due: t.due, status: SCHEDULE_STATUSES.includes(t.status as ScheduleStatus) ? t.status as ScheduleStatus : "belum", component: typeof t.component === "string" ? t.component : "", color: SCHEDULE_COLORS.includes(t.color as ScheduleColor) ? t.color as ScheduleColor : "lavender", stage: t.stage === true, checks, ...(weight !== undefined ? { weight } : {}), ...(cost !== undefined ? { cost } : {}), ...(progressEntries ? { progressEntries } : {}) }];
  });
  const used = new Set<number>();
  let next = Math.max(0, ...normalized.map((t) => t.taskNumber ?? 0)) + 1;
  return normalized.map((t, index) => {
    let number = t.taskNumber ?? index + 1;
    if (used.has(number)) number = next++;
    used.add(number);
    return { ...t, taskNumber: number };
  });
}

export function nextTaskNumber(tasks: ScheduleTask[]): number {
  return Math.max(0, ...tasks.map((t) => t.taskNumber ?? 0)) + 1;
}

export function predecessorText(task: ScheduleTask, tasks: ScheduleTask[]): string {
  return taskPredecessors(task).map((link) => {
    const previous = tasks.find((t) => t.id === link.taskId);
    const lag = link.lag ?? 0;
    return previous ? `${previous.taskNumber}${link.type}${lag ? `${lag > 0 ? "+" : ""}${lag}` : ""}` : "";
  }).filter(Boolean).join(";");
}

export function parsePredecessors(text: string, task: ScheduleTask, tasks: ScheduleTask[], defaultType: PredecessorType = "FS"): SchedulePredecessor[] {
  if (!text.trim()) return [];
  const tokens = text.trim().replace(/^\((.*)\)$/, "$1").split(";");
  const links = tokens.map((token) => {
    if (!token.trim()) throw new Error("Setiap predecessor harus berisi ID pekerjaan.");
    return parsePredecessor(token, task, tasks, defaultType);
  }).filter((link): link is SchedulePredecessor => link !== undefined);
  return links.filter((link, index) => links.findIndex((other) => other.taskId === link.taskId && other.type === link.type && (other.lag ?? 0) === (link.lag ?? 0)) === index);
}

export function parsePredecessor(text: string, task: ScheduleTask, tasks: ScheduleTask[], defaultType: PredecessorType = "FS"): ScheduleTask["predecessor"] {
  if (!text.trim()) return undefined;
  const match = /^(\d+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+)?$/i.exec(text.trim());
  if (!match) throw new Error("Predecessor tidak valid. Gunakan contoh 2FS+3 atau 4FF-5.");
  const previous = tasks.find((t) => t.taskNumber === Number(match[1]));
  if (!previous) throw new Error("ID pekerjaan pendahulu tidak ditemukan pada sketsa ini.");
  if (previous.id === task.id) throw new Error("Pekerjaan tidak dapat mendahului dirinya sendiri.");
  const lag = Number(match[3]?.replace(/\s/g, "") ?? 0);
  if (!Number.isSafeInteger(lag)) throw new Error("Offset hari tidak valid.");
  return { taskId: previous.id, type: (match[2]?.toUpperCase() ?? defaultType) as PredecessorType, ...(lag ? { lag } : {}) };
}

/** Resolve a dependency graph before saving; durations stay unchanged, references use stable UUIDs. */
export function resolveScheduleDependencies(tasks: ScheduleTask[]): ScheduleTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const resolved = new Map<string, ScheduleTask>();
  const visiting = new Set<string>();
  function resolve(task: ScheduleTask): ScheduleTask {
    const cached = resolved.get(task.id);
    if (cached) return cached;
    if (visiting.has(task.id)) throw new Error("Hubungan pekerjaan membentuk siklus. Pilih pendahulu lain.");
    visiting.add(task.id);
    let result = task;
    const links = taskPredecessors(task);
    if (links.length) {
      const starts = links.map((link) => {
        const source = byId.get(link.taskId);
        if (!source) throw new Error("Pekerjaan pendahulu masih digunakan dan tidak dapat dihapus.");
        if (!Number.isSafeInteger(link.lag ?? 0)) throw new Error("Offset hari tidak valid.");
        const previous = resolve(source);
        const start = format(addDays(parseISO(previous.start), predecessorStartOffset(previous, task, link)), "yyyy-MM-dd");
        if (!validScheduleDate(start)) throw new Error("Tanggal hasil hubungan berada di luar rentang yang didukung.");
        return start;
      });
      const start = starts.sort().at(-1);
      if (start) result = { ...task, start, due: scheduleDue(start, scheduleDuration(task.start, task.due)) };
    }
    if (!validScheduleDate(result.start) || !validScheduleDate(result.due)) throw new Error("Tanggal hasil hubungan berada di luar rentang yang didukung.");
    visiting.delete(task.id);
    resolved.set(task.id, result);
    return result;
  }
  return tasks.map(resolve);
}

/** Level hierarki WBS: 1 = tahapan, 2 = disiplin, 3 = rincian, 4 = rincian terkecil. */
export function wbsLevel(wbs: string): 1 | 2 | 3 | 4 {
  const parts = wbs.trim().replace(/\.+$/, "").split(".").filter(Boolean).length;
  return Math.min(4, Math.max(1, parts)) as 1 | 2 | 3 | 4;
}
export const WBS_LEVEL_LABELS = { 1: "Tahapan", 2: "Disiplin / pekerjaan utama", 3: "Rincian pekerjaan", 4: "Rincian terkecil" } as const;

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

/**
 * Salin jadwal milik sketsa sumber ke sketsa hasil duplikat.
 * ID pekerjaan dipertahankan karena acuan predecessor bersifat lokal per sketsa.
 * Mengembalikan store baru; store sumber tidak berubah.
 */
export function copyScheduleEntry(store: ScheduleStore, sourceId: string, targetId: string): ScheduleStore {
  const tasks = store[sourceId];
  if (!tasks?.length || sourceId === targetId) return store;
  return { ...store, [targetId]: tasks.map((task) => ({ ...task, checks: task.checks.map((check) => ({ ...check })), ...(task.progressEntries ? { progressEntries: task.progressEntries.map((entry) => ({ ...entry })) } : {}), ...(task.predecessor ? { predecessor: { ...task.predecessor } } : {}), ...(task.predecessors ? { predecessors: task.predecessors.map((link) => ({ ...link })) } : {}) })) };
}