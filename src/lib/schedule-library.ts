import { nextTaskNumber, resolveScheduleDependencies, scheduleDue, type ScheduleTask, type SchedulePredecessor, type PredecessorType } from "./schedule";

export const SCHEDULE_LIBRARY_KEY = "dabidabis_schedule_library_v1";
export type LibraryWork = { id: string; wbs: string; title: string; duration: number; predecessor: string };
export type ScheduleTemplate = { id: string; works: LibraryWork[] };

export function validateTemplate(template: ScheduleTemplate): ScheduleTemplate {
  if (!template.works.length) throw new Error("Tambahkan judul pekerjaan.");
  const paths = new Set<string>();
  const works = template.works.map((work) => {
    const wbs = work.wbs.trim().toLowerCase();
    if (!/^[a-z]+(?:\.[a-z]+)*$/.test(wbs)) throw new Error("WBS harus berupa huruf, misalnya a.a.");
    if (paths.has(wbs)) throw new Error("WBS pustaka tidak boleh sama.");
    paths.add(wbs);
    if (!work.title.trim()) throw new Error("Isi setiap judul pekerjaan.");
    if (!Number.isSafeInteger(work.duration) || work.duration < 0 || work.duration > 36500) throw new Error("Durasi harus 0–36500 hari.");
    return { ...work, wbs, title: work.title.trim(), predecessor: work.predecessor.trim().toLowerCase() };
  });
  const roots = works.filter((work) => !work.wbs.includes("."));
  const root = roots[0];
  if (roots.length !== 1 || !root) throw new Error("Setiap template harus memiliki satu WBS utama.");
  for (const work of works) {
    if (work.wbs !== root.wbs && (!work.wbs.startsWith(root.wbs + ".") || !paths.has(work.wbs.split(".").slice(0, -1).join(".")))) throw new Error("Lengkapi WBS induk setiap pekerjaan.");
  }
  const cleaned = { ...template, works: works.sort((a, b) => a.wbs.localeCompare(b.wbs)) };
  // The same dependency resolver validates missing references, self-links and cycles.
  const tasks = works.map((work, index): ScheduleTask => ({ id: work.wbs, taskNumber: index + 1, wbs: work.wbs, title: work.title, start: "2026-01-01", due: scheduleDue("2026-01-01", work.duration), owner: "", status: "belum", component: "", color: "stage", stage: false, checks: [], predecessors: libraryLinks(work, works, new Map(works.map((row) => [row.wbs, row.wbs]))) }));
  resolveScheduleDependencies(tasks);
  return cleaned;
}

function libraryLinks(work: LibraryWork, works: LibraryWork[], ids: Map<string, string>): SchedulePredecessor[] {
  if (!work.predecessor.trim()) return [];
  return work.predecessor.split(";").map((token) => {
    const match = /^([a-z]+?(?:\.[a-z]+?)*?)\s*(fs|ss|ff|sf)?\s*([+-]\s*\d+)?$/i.exec(token.trim());
    if (!match) throw new Error("Predecessor pustaka tidak valid. Contoh: a.aFS+2;a.bSS.");
    const path = match[1].toLowerCase();
    const taskId = ids.get(path);
    if (!taskId || !works.some((row) => row.wbs === path)) throw new Error("WBS predecessor tidak ditemukan dalam template.");
    if (path === work.wbs) throw new Error("Pekerjaan tidak dapat mendahului dirinya sendiri.");
    const lag = Number(match[3]?.replace(/\s/g, "") ?? 0);
    if (!Number.isSafeInteger(lag)) throw new Error("Offset predecessor tidak valid.");
    return { taskId, type: (match[2]?.toUpperCase() ?? "FS") as PredecessorType, ...(lag ? { lag } : {}) };
  });
}

export function readScheduleLibrary(raw: string | null): ScheduleTemplate[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      try {
        if (!entry || typeof entry.id !== "string" || !Array.isArray(entry.works) || !entry.works.every((work: LibraryWork) => work && typeof work.id === "string" && typeof work.wbs === "string" && typeof work.title === "string" && typeof work.predecessor === "string")) return [];
        return [validateTemplate(entry)];
      } catch { return []; }
    });
  } catch { return []; }
}

/** Replace the calling root group, or append a fresh root for a new task. */
export function applyScheduleTemplate(tasks: ScheduleTask[], template: ScheduleTemplate, start: string, targetId?: string, makeId = () => crypto.randomUUID()): ScheduleTask[] {
  const valid = validateTemplate(template);
  const target = tasks.find((task) => task.id === targetId);
  const rootNumber = target?.wbs.split(".")[0] ?? String(Math.max(0, ...tasks.map((task) => Number(task.wbs.split(".")[0]) || 0)) + 1);
  const group = target ? tasks.filter((task) => task.wbs === rootNumber || task.wbs.startsWith(rootNumber + ".")) : [];
  const mapping = new Map<string, string>();
  const root = valid.works.find((work) => !work.wbs.includes("."));
  if (!root) throw new Error("WBS utama tidak ditemukan.");
  mapping.set(root.wbs, rootNumber);
  const counters = new Map<string, number>();
  for (const work of valid.works) {
    if (work === root) continue;
    const parent = work.wbs.split(".").slice(0, -1).join(".");
    const n = (counters.get(parent) ?? 0) + 1;
    counters.set(parent, n);
    mapping.set(work.wbs, `${mapping.get(parent)}.${n}`);
  }
  const ids = new Map(valid.works.map((work) => [work.wbs, group.find((task) => task.wbs === mapping.get(work.wbs))?.id ?? makeId()]));
  let number = nextTaskNumber(tasks);
  const added = valid.works.map((work): ScheduleTask => {
    const wbs = mapping.get(work.wbs);
    const id = ids.get(work.wbs);
    if (!wbs || !id) throw new Error("Hierarki template tidak valid.");
    const previous = group.find((task) => task.wbs === wbs);
    const depth = wbs.split(".").length;
    return { ...(previous ?? { owner: "", status: "belum", component: "", checks: [] }), id, taskNumber: previous?.taskNumber ?? number++, wbs, title: work.title, start, due: scheduleDue(start, work.duration), stage: depth === 1, color: depth === 1 ? "stage" : depth === 2 ? "lavender" : depth === 3 ? "green" : "yellow", predecessor: undefined, predecessors: libraryLinks(work, valid.works, ids) };
  });
  return resolveScheduleDependencies([...tasks.filter((task) => !group.includes(task)), ...added].sort((a, b) => a.wbs.localeCompare(b.wbs, undefined, { numeric: true })));
}