import { normalizeScheduleStore, type ScheduleTask } from "./schedule";
import { DEFAULT_SCHEDULE_VIEW, normalizeScheduleViews, type ScheduleView } from "./schedule-analysis";

export type NamedSchedule = { id: string; name: string; tasks: ScheduleTask[]; view: ScheduleView };
export type ScheduleCollections = Record<string, NamedSchedule[]>;

export function createNamedSchedule(id: string, name = "Jadwal"): NamedSchedule {
  return { id, name, tasks: [], view: structuredClone(DEFAULT_SCHEDULE_VIEW) };
}

/** The existing storage key now holds all schedules and their settings atomically. */
export function readScheduleCollections(value: unknown, legacyViews: unknown = {}, fallbackId?: string | null): ScheduleCollections {
  if (value && typeof value === "object" && "version" in value && value.version === 2 && "sketches" in value) {
    const sketches = value.sketches;
    if (!sketches || typeof sketches !== "object" || Array.isArray(sketches)) return {};
    return Object.fromEntries(Object.entries(sketches).flatMap(([sketchId, entries]) => {
      if (!Array.isArray(entries)) return [];
      const seen = new Set<string>();
      const schedules = entries.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object") return [];
        const item = entry as Partial<NamedSchedule>;
        if (typeof item.id !== "string" || !item.id || seen.has(item.id)) return [];
        seen.add(item.id);
        const tasks = normalizeScheduleStore({ tasks: item.tasks }).tasks ?? [];
        const view = normalizeScheduleViews({ view: item.view }).view ?? structuredClone(DEFAULT_SCHEDULE_VIEW);
        return [{ id: item.id, name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Jadwal", tasks, view }];
      });
      return [[sketchId, schedules]];
    }));
  }
  const tasks = normalizeScheduleStore(value, fallbackId);
  const views = normalizeScheduleViews(legacyViews);
  const ids = new Set([...Object.keys(tasks), ...Object.keys(views)]);
  return Object.fromEntries([...ids].map((id) => [id, [{ ...createNamedSchedule(id), tasks: tasks[id] ?? [], view: views[id] ?? structuredClone(DEFAULT_SCHEDULE_VIEW) }]]));
}

export function serializeScheduleCollections(store: ScheduleCollections): string {
  return JSON.stringify({ version: 2, sketches: store });
}

export function schedulesForSketch(store: ScheduleCollections, sketchId: string): NamedSchedule[] {
  return store[sketchId] ?? [createNamedSchedule(sketchId)];
}

export function addNamedSchedule(store: ScheduleCollections, sketchId: string, id: string): ScheduleCollections {
  const schedules = schedulesForSketch(store, sketchId);
  let number = schedules.length + 1;
  while (schedules.some((schedule) => schedule.name === `Jadwal ${number}`)) number++;
  return { ...store, [sketchId]: [...schedules, createNamedSchedule(id, `Jadwal ${number}`)] };
}

export function renameNamedSchedule(store: ScheduleCollections, sketchId: string, id: string, name: string): ScheduleCollections {
  if (!name.trim()) throw new Error("Nama jadwal tidak boleh kosong.");
  return { ...store, [sketchId]: schedulesForSketch(store, sketchId).map((schedule) => schedule.id === id ? { ...schedule, name: name.trim() } : schedule) };
}

export function deleteNamedSchedule(store: ScheduleCollections, sketchId: string, id: string, confirmed: boolean): ScheduleCollections {
  if (!confirmed) return store;
  return { ...store, [sketchId]: schedulesForSketch(store, sketchId).filter((schedule) => schedule.id !== id) };
}

export function copyNamedSchedules(store: ScheduleCollections, sourceId: string, targetId: string): ScheduleCollections {
  if (sourceId === targetId || !(sourceId in store)) return store;
  return { ...store, [targetId]: store[sourceId].map((schedule) => ({ ...structuredClone(schedule), id: crypto.randomUUID() })) };
}