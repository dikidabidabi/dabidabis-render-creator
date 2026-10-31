import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { addDays, differenceInCalendarDays, eachMonthOfInterval, format, parseISO, startOfMonth, endOfMonth, startOfWeek } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { CalendarDays, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, FileDown, ListChecks, Pencil, PenTool, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { addNamedSchedule, deleteNamedSchedule, readScheduleCollections, renameNamedSchedule, schedulesForSketch, serializeScheduleCollections, type ScheduleCollections } from "@/lib/schedule-collections";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScheduleDateCell } from "@/components/schedule-date-cell";
import { fillScheduleDates, SCHEDULE_DATE_LABELS, type ScheduleDateField } from "@/lib/schedule-dates";
import { ScheduleDatePicker } from "@/components/schedule-date-picker";
import { ScheduleDependencyLinks } from "@/components/schedule-dependency-links";
import { ScheduleTaskProgress } from "@/components/schedule-task-progress";
import { ScheduleSCurve } from "@/components/schedule-s-curve";
import { ScheduleActualWeightFill } from "@/components/schedule-actual-weight-fill";
import { ScheduleWeeklySummary } from "@/components/schedule-weekly-summary";
import { criticalPath, actualBarRanges, delayBarRange, descendants, visibleSchedule, SCHEDULE_VIEW_KEY, DEFAULT_SCHEDULE_VIEW, type ScheduleView } from "@/lib/schedule-analysis";
import { scheduleBarBounds, SCHEDULE_ROW_HEIGHT } from "@/lib/schedule-connectors";
import { SCHEDULE_KEY, SCHEDULE_COLORS, SCHEDULE_STATUSES, SKETCH_STORE_KEY, WBS_LEVEL_LABELS, PREDECESSOR_TYPES, PREDECESSOR_LABELS, nextTaskNumber, predecessorText, parsePredecessors, taskPredecessors, resolveScheduleDependencies, readSketchStore, scheduleDue, scheduleDuration, scheduleProgress, totalScheduleProgress, wbsLevel, type PredecessorType, type ScheduleTask, type SketchRef } from "@/lib/schedule";
import { setProjectItem } from "@/lib/storage/idb-bridge";
import { printScheduleSection } from "@/lib/schedule-print";
import { isWeightRoot, scheduleWeights, weeklyTaskWeights, weeklyActualWeights, formatScheduleWeight, weeklyScheduleSummary } from "@/lib/schedule-weights";
import { useAuth } from "@/lib/auth";
import { editScheduleCost, formatScheduleCost, hasProjectCost, scheduleCosts, validScheduleCost } from "@/lib/schedule-costs";
import { ScheduleTitlePicker } from "@/components/schedule-title-picker";
import { applyScheduleTemplate, readScheduleLibrary, SCHEDULE_LIBRARY_KEY, type ScheduleTemplate } from "@/lib/schedule-library";

export const Route = createFileRoute("/jadwal")({
  component: SchedulePage,
  head: () => ({ meta: [
    { title: "Jadwal — Pekerjaan & Progres | Dabidabi's" },
    { name: "description", content: "Kelola WBS, jadwal pekerjaan, penanggung jawab, dan progres bertanggal per pekerjaan dan Kurva S per sketsa dalam tabel dan diagram Gantt privat Dabidabi's." },
    { property: "og:title", content: "Jadwal — Pekerjaan & Progres | Dabidabi's" },
    { property: "og:description", content: "Jadwal proyek per sketsa dengan bar waktu, progres bertanggal tiap pekerjaan, Kurva S, dan penanda hari berjalan." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
});

const STATUS_LABELS = { belum: "Belum mulai", berjalan: "Berjalan", berisiko: "Berisiko", tertunda: "Tertunda", selesai: "Selesai" };
const COLOR_LABELS = { stage: "Jingga", lavender: "Lavender", green: "Hijau", yellow: "Kuning", neutral: "Netral" };
const TABLE_WIDTH = 1695;

function SchedulePage() {
  const { user } = useAuth();
  return user ? <ScheduleWorkspace key={user.id} /> : null;
}

function ScheduleWorkspace() {
  const [sketches, setSketches] = useState<SketchRef[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [store, setStore] = useState<ScheduleCollections>({});
  const [selectedSchedules, setSelectedSchedules] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState(false);
  const [scheduleName, setScheduleName] = useState("");
  const [deletingSchedule, setDeletingSchedule] = useState(false);
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [templateChoice, setTemplateChoice] = useState<{ template: ScheduleTemplate; targetId?: string; start: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState(() => new Date());
  const [view, setView] = useState("combined");
  const [scale, setScale] = useState("month");
  const [draft, setDraft] = useState<ScheduleTask | null>(null);
  const [deleting, setDeleting] = useState<ScheduleTask | null>(null);
  const [error, setError] = useState("");
  const [predecessorInput, setPredecessorInput] = useState("");
  const [predecessorType, setPredecessorType] = useState<PredecessorType>("FS");
  const [saving, setSaving] = useState(false);
  const queue = useRef(Promise.resolve());
  const [fillRange, setFillRange] = useState<{ field: ScheduleDateField; from: number; to: number } | null>(null);
  const fillCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => fillCleanup.current?.(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function load() {
      try {
        const sketchStore = readSketchStore(localStorage.getItem(SKETCH_STORE_KEY));
        setSketches(sketchStore.sketches);
        const fallbackId = sketchStore.openId && sketchStore.sketches.some((s) => s.id === sketchStore.openId) ? sketchStore.openId : sketchStore.sketches[0]?.id ?? null;
        setActiveId((current) => current && sketchStore.sketches.some((s) => s.id === current) ? current : fallbackId);
        const savedView = JSON.parse(localStorage.getItem(SCHEDULE_VIEW_KEY) || "{}");
        setStore(readScheduleCollections(JSON.parse(localStorage.getItem(SCHEDULE_KEY) || "null"), savedView, fallbackId));
        setTemplates(readScheduleLibrary(localStorage.getItem(SCHEDULE_LIBRARY_KEY)));
      } catch { toast.error("Data jadwal tidak dapat dibaca."); }
      setReady(true);
    }
    load();
    const onStorage = (event: StorageEvent) => { if (event.key === SKETCH_STORE_KEY) load(); };
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(() => setToday(new Date()), 60_000);
    return () => { window.removeEventListener("storage", onStorage); window.clearInterval(timer); };
  }, []);

  const schedules = activeId ? schedulesForSketch(store, activeId) : [];
  const activeSchedule = schedules.find((schedule) => activeId && schedule.id === selectedSchedules[activeId]) ?? schedules[0] ?? null;
  const tasks = activeSchedule?.tasks ?? [];
  const settings = activeSchedule?.view ?? DEFAULT_SCHEDULE_VIEW;
  const visibleTasks = visibleSchedule(tasks, settings.collapsed);
  const cpm = useMemo(() => criticalPath(tasks, settings.slack), [tasks, settings.slack]);
  const costs = useMemo(() => scheduleCosts(tasks, settings.projectCost), [tasks, settings.projectCost]);
  const weights = useMemo(() => scheduleWeights(tasks, settings.projectCost), [tasks, settings.projectCost]);
  const tableWidth = TABLE_WIDTH + (settings.costs ? 155 : 0);
  const activeSketch = sketches.find((s) => s.id === activeId) ?? null;

  function persist(nextStore: ScheduleCollections) {
    setStore(nextStore);
    setSaving(true);
    const write = queue.current.catch(() => {}).then(() => setProjectItem(SCHEDULE_KEY, serializeScheduleCollections(nextStore)));
    queue.current = write;
    void write.then(() => { if (queue.current === write) setSaving(false); }, () => { setSaving(false); toast.error("Jadwal belum tersimpan. Silakan coba lagi."); });
  }
  function saveSettings(next: ScheduleView) {
    if (!activeId || !activeSchedule) return;
    try { scheduleCosts(tasks, next.projectCost); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Biaya tidak valid."); return; }
    persist({ ...store, [activeId]: schedules.map((schedule) => schedule.id === activeSchedule.id ? { ...schedule, view: next } : schedule) });
  }
  function selectSchedule(sketchId: string, scheduleId?: string) {
    fillCleanup.current?.();
    setActiveId(sketchId);
    if (scheduleId) setSelectedSchedules((current) => ({ ...current, [sketchId]: scheduleId }));
    setDraft(null); setDeleting(null); setRenaming(false); setDeletingSchedule(false);
    setTemplateChoice(null);
  }
  function addSchedule() {
    if (!activeId) return;
    const id = crypto.randomUUID();
    persist(addNamedSchedule(store, activeId, id));
    selectSchedule(activeId, id);
  }
  function saveScheduleName() {
    if (!activeId || !activeSchedule) return;
    try { persist(renameNamedSchedule(store, activeId, activeSchedule.id, scheduleName)); setRenaming(false); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Nama jadwal tidak valid."); }
  }
  function removeSchedule() {
    if (!activeId || !activeSchedule) return;
    persist(deleteNamedSchedule(store, activeId, activeSchedule.id, true));
    selectSchedule(activeId);
  }
  function toggleHierarchy(task: ScheduleTask) {
    saveSettings({ ...settings, collapsed: settings.collapsed.includes(task.id) ? settings.collapsed.filter((id) => id !== task.id) : [...settings.collapsed, task.id] });
  }

  function commit(next: ScheduleTask[]) {
    if (!activeId || !activeSchedule) return false;
    try { scheduleCosts(next, settings.projectCost); next = resolveScheduleDependencies(next); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Hubungan tidak valid."); return false; }
    persist({ ...store, [activeId]: schedules.map((schedule) => schedule.id === activeSchedule.id ? { ...schedule, tasks: next } : schedule) });
    return true;
  }

  function changeDates(ids: string[], field: ScheduleDateField, value: string) {
    try { commit(fillScheduleDates(tasks, ids, field, value)); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Tanggal tidak valid."); }
  }
  function startFill(event: ReactPointerEvent<HTMLButtonElement>, task: ScheduleTask, field: ScheduleDateField) {
    event.preventDefault(); event.stopPropagation();
    fillCleanup.current?.();
    const from = visibleTasks.findIndex((item) => item.id === task.id);
    let to = from;
    const source = task[field];
    if (from < 0 || !source) return;
    setFillRange({ field, from, to });
    const move = (pointer: PointerEvent) => {
      pointer.preventDefault();
      const scroll = scrollRef.current;
      if (scroll) {
        const bounds = scroll.getBoundingClientRect();
        if (pointer.clientY > bounds.bottom - 35) scroll.scrollTop += 18;
        else if (pointer.clientY < bounds.top + 80) scroll.scrollTop -= 18;
      }
      const row = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>("[data-task-id]");
      const index = visibleTasks.findIndex((item) => item.id === row?.dataset.taskId);
      if (index >= from) { to = index; setFillRange({ field, from, to }); }
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", cancel);
      setFillRange(null); fillCleanup.current = null;
    };
    const end = () => { cleanup(); if (to > from) changeDates(visibleTasks.slice(from + 1, to + 1).map((item) => item.id), field, source); };
    const cancel = () => cleanup();
    fillCleanup.current = cleanup;
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", end, { once: true });
    document.addEventListener("pointercancel", cancel, { once: true });
  }
  function dateCell(task: ScheduleTask, field: ScheduleDateField, index: number) {
    return <ScheduleDateCell task={task} field={field} selected={fillRange?.field === field && index >= fillRange.from && index <= fillRange.to} onChange={(value) => changeDates([task.id], field, value)} onFillStart={(event) => startFill(event, task, field)} />;
  }

  function openTask(task: ScheduleTask) {
    setError("");
    setPredecessorInput(predecessorText(task, tasks));
    setPredecessorType(taskPredecessors(task)[0]?.type ?? "FS");
    setDraft(structuredClone(task));
  }

  function newTask(stage = false) {
    const date = format(today, "yyyy-MM-dd");
    setError("");
    setPredecessorInput("");
    setPredecessorType("FS");
    setDraft({ id: crypto.randomUUID(), taskNumber: nextTaskNumber(tasks), wbs: "", title: "", owner: "", start: date, due: scheduleDue(date, 7), status: "belum", component: "", color: stage ? "stage" : "lavender", stage, checks: [] });
  }

  const dates = useMemo(() => {
    const current = format(today, "yyyy-MM-dd");
    const first = [current, ...tasks.flatMap((t) => [t.start, ...(t.actualStart ? [t.actualStart] : [])])].sort()[0];
    const last = [current, ...tasks.flatMap((t) => [t.due, ...(t.actualFinish ? [t.actualFinish] : []), ...(t.progressEntries ?? []).filter((entry) => entry.actual >= 100).map((entry) => entry.date)])].sort().at(-1) || current;
    return { start: startOfMonth(parseISO(first)), end: endOfMonth(addDays(parseISO(last), 14)) };
  }, [tasks, today]);
  const dayWidth = scale === "week" ? 22 : 6;
  const days = differenceInCalendarDays(dates.end, dates.start) + 1;
  const timelineWidth = Math.max(720, days * dayWidth);
  const offset = (date: Date) => differenceInCalendarDays(date, dates.start) * dayWidth;
  const months = eachMonthOfInterval(dates);
  const showTable = view !== "timeline";
  const showTimeline = view !== "table";
  const timelineLeft = showTable ? tableWidth : 220;
  const totalWidth = timelineLeft + (showTimeline ? timelineWidth : 0);
  const weekOrigin = startOfWeek(dates.start, { weekStartsOn: 1 });
  const summaryWeeks = Array.from({ length: Math.ceil((differenceInCalendarDays(dates.end, weekOrigin) + 1) / 7) }, (_, index) => addDays(weekOrigin, index * 7));
  const weeklySummary = weeklyScheduleSummary(tasks, weights, summaryWeeks, format(today, "yyyy-MM-dd"));
  const todayX = offset(today) + dayWidth / 2;
  const percentage = totalScheduleProgress(tasks);

  function goToday() {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTo({ left: timelineLeft + todayX - scroll.clientWidth / 2, behavior: "smooth" });
  }
  function saveDraft() {
    if (!draft) return;
    if (!draft.wbs.trim() || !draft.title.trim()) { setError("Isi nomor WBS dan judul pekerjaan."); return; }
    if (tasks.some((t) => t.id !== draft.id && t.wbs.trim() === draft.wbs.trim())) { setError("Nomor WBS sudah dipakai pekerjaan lain."); return; }
    if (draft.due < draft.start) { setError("Tenggat tidak boleh sebelum tanggal mulai."); return; }
    if (draft.actualStart && draft.actualFinish && draft.actualFinish < draft.actualStart) { setError("Aktual selesai tidak boleh sebelum aktual mulai."); return; }
    let predecessors: ScheduleTask["predecessors"];
    try { predecessors = parsePredecessors(predecessorInput, draft, tasks, predecessorType); } catch (cause) { setError(cause instanceof Error ? cause.message : "Hubungan tidak valid."); return; }
    const clean = { ...draft, predecessor: undefined, predecessors, title: draft.title.trim(), wbs: draft.wbs.trim(), checks: draft.checks.filter((c) => c.title.trim()).map((c) => ({ ...c, title: c.title.trim() })) };
    const next = tasks.some((t) => t.id === draft.id) ? tasks.map((t) => t.id === draft.id ? clean : t) : [...tasks, clean].sort((a, b) => a.wbs.localeCompare(b.wbs, undefined, { numeric: true }));
    try { resolveScheduleDependencies(next); } catch (cause) { setError(cause instanceof Error ? cause.message : "Hubungan tidak valid."); return; }
    if (!commit(next)) return;
    setDraft(null);
  }
  const update = (value: Partial<ScheduleTask>) => setDraft((current) => current ? { ...current, ...value } : null);

  function applyTemplate() {
    if (!templateChoice) return;
    try {
      const next = applyScheduleTemplate(tasks, templateChoice.template, templateChoice.start, templateChoice.targetId);
      if (commit(next)) { setTemplateChoice(null); setDraft(null); }
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Template tidak dapat diterapkan."); }
  }

  return <main className="schedule-page flex flex-col gap-6 px-4 lg:flex-row py-7 sm:px-6">
    <aside className="w-full shrink-0 lg:w-52 print:hidden" aria-label="Daftar sketsa">
      <p className="mb-3 text-xs font-medium uppercase text-ember">Sketsa</p>
      <div className="flex gap-2 overflow-x-auto lg:block lg:space-y-1">
        {sketches.map((sketch) => {
          const sketchSchedules = schedulesForSketch(store, sketch.id);
          const active = sketch.id === activeId;
          return <div key={sketch.id} className="min-w-44 lg:min-w-0">
            <Button variant="ghost" onClick={() => selectSchedule(sketch.id)} aria-current={active ? "true" : undefined} className={`h-auto w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left ${active ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted/60"}`}>
              <span className="w-full truncate text-sm font-medium" title={sketch.title}>{sketch.title}</span>
              <span className="text-[11px] font-normal text-muted-foreground">{sketchSchedules.length} jadwal</span>
            </Button>
            {active && <div className="my-2 space-y-1 border-l border-border pl-2" aria-label="Daftar jadwal">{sketchSchedules.map((schedule) => <Button key={schedule.id} variant="ghost" onClick={() => selectSchedule(sketch.id, schedule.id)} aria-current={schedule.id === activeSchedule?.id ? "true" : undefined} className={`h-auto w-full flex-col items-start gap-0.5 px-2 py-2 text-left ${schedule.id === activeSchedule?.id ? "bg-primary/10 text-primary" : ""}`}><span className="w-full truncate text-xs" title={schedule.name}>{schedule.name}</span><span className="text-[10px] font-normal text-muted-foreground">{schedule.tasks.length} pekerjaan · {totalScheduleProgress(schedule.tasks)}%</span></Button>)}</div>}
          </div>;
        })}
      </div>
      {!sketches.length && ready && <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground"><p>Belum ada sketsa.</p><Link to="/sketch" className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"><PenTool className="size-3" />Buka halaman Sketsa</Link></div>}
    </aside>

    <div className="schedule-main min-w-0 flex-1">
    <div className="mb-4 print:hidden"><Button asChild variant="outline"><Link to="/jadwal/pustaka"><ListChecks />Pustaka jadwal</Link></Button></div>
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-full"><p className="mb-2 text-xs font-medium uppercase text-ember">Project · Jadwal</p>{renaming ? <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); saveScheduleName(); }}><Input autoFocus aria-label="Nama jadwal" className="w-72 max-w-full font-display text-xl" value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} /><Button type="submit" size="sm">Simpan</Button><Button type="button" size="sm" variant="outline" onClick={() => setRenaming(false)}>Batal</Button></form> : <div className="flex items-start gap-2"><h1 className="min-w-0 break-words font-display text-3xl font-semibold">{activeSchedule?.name ?? "Jadwal"}</h1><Button variant="ghost" size="icon" className="shrink-0 print:hidden" aria-label="Ubah nama jadwal" title="Ubah nama jadwal" disabled={!activeSchedule} onClick={() => { setScheduleName(activeSchedule?.name ?? ""); setRenaming(true); }}><Pencil className="size-4" /></Button></div>}<p className="mt-2 text-sm text-muted-foreground">{activeSketch ? <span className="font-medium text-foreground">{activeSketch.title}</span> : "Tanpa sketsa"}<span className="mx-2">·</span>{format(today, "EEEE, d MMMM yyyy", { locale: localeId })}<span className="mx-2">·</span>{tasks.length} pekerjaan<span className="mx-2">·</span>{saving ? "Menyimpan…" : "Tersimpan"}</p></div>
      <div className="flex flex-wrap items-center gap-3"><div className="text-right"><p className="text-xs text-muted-foreground">Progres keseluruhan</p><p className="mt-1 font-display text-3xl font-semibold text-primary">{percentage}%</p></div><div className="h-10 w-px bg-border print:hidden" /><Button variant="outline" className="print:hidden" onClick={() => printScheduleSection(printRef.current, "schedule")} disabled={!ready || !activeId || !tasks.length} title="Unduh jadwal sebagai PDF lanskap"><FileDown />Unduh PDF</Button><Button variant="outline" className="print:hidden" onClick={() => newTask(true)} disabled={!ready || !activeSchedule}><Plus />Tahap</Button><Button className="print:hidden" onClick={() => newTask()} disabled={!ready || !activeSchedule}><Plus />Pekerjaan</Button></div>
    </header>
    <div className="mb-4 flex flex-wrap items-end justify-end gap-2 print:hidden"><div className="mr-2 space-y-1"><Label htmlFor="project-cost" className="text-xs">Biaya proyek (total · Rp)</Label><Input key={`${activeSchedule?.id}-${settings.projectCost}`} id="project-cost" type="number" min={0} step="any" disabled={!activeSchedule} className="h-9 w-52" placeholder="—" defaultValue={settings.projectCost ?? ""} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const text = event.currentTarget.value.trim(); const value = text ? Number(text) : undefined; if (value !== undefined && !validScheduleCost(value)) { toast.error("Biaya proyek harus berupa angka positif atau nol."); event.currentTarget.value = String(settings.projectCost ?? ""); return; } try { scheduleCosts(tasks, value); saveSettings({ ...settings, projectCost: value }); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Biaya tidak valid."); event.currentTarget.value = String(settings.projectCost ?? ""); } }} /></div><Button variant="outline" disabled={!ready || !activeId} onClick={addSchedule}><Plus />Tambah jadwal</Button><Button variant="outline" className="text-destructive" disabled={!activeSchedule} onClick={() => setDeletingSchedule(true)}><Trash2 />Hapus jadwal</Button></div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-border py-3 print:hidden">
      <div className="flex flex-wrap items-center gap-5"><div className="flex items-center gap-2"><Checkbox id="schedule-costs" checked={settings.costs === true} disabled={!activeSchedule} onCheckedChange={(checked) => saveSettings({ ...settings, costs: checked === true })} /><Label htmlFor="schedule-costs">Biaya</Label></div><div className="flex items-center gap-2"><Checkbox id="schedule-weights" checked={settings.weights === true} onCheckedChange={(checked) => saveSettings({ ...settings, weights: checked === true })} /><Label htmlFor="schedule-weights">Bobot</Label></div><div className="space-y-2"><div className="flex items-center gap-2"><Checkbox id="critical-path" checked={settings.cpm} onCheckedChange={(checked) => saveSettings({ ...settings, cpm: checked === true })} /><Label htmlFor="critical-path">Jalur kritis (CPM)</Label></div><div className="flex items-center gap-2"><Label htmlFor="slack" className="text-xs">Slack (hari)</Label><Input id="slack" type="number" min={0} step={1} className="h-8 w-20" value={settings.slack} onChange={(event) => saveSettings({ ...settings, slack: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })} /></div></div><ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v); }} aria-label="Tampilan jadwal"><ToggleGroupItem value="combined">Tabel & Gantt</ToggleGroupItem><ToggleGroupItem value="table">Tabel</ToggleGroupItem><ToggleGroupItem value="timeline">Gantt</ToggleGroupItem></ToggleGroup></div>
      <div className="flex flex-wrap items-center gap-2"><ToggleGroup type="single" value={scale} onValueChange={(v) => { if (v) setScale(v); }} aria-label="Skala waktu"><ToggleGroupItem value="week">Minggu</ToggleGroupItem><ToggleGroupItem value="month">Bulan</ToggleGroupItem></ToggleGroup><Button size="icon" variant="ghost" title="Waktu sebelumnya" aria-label="Waktu sebelumnya" onClick={() => scrollRef.current?.scrollBy({ left: -300, behavior: "smooth" })}><ChevronLeft /></Button><Button variant="outline" onClick={goToday}><CalendarDays />Hari ini</Button><Button size="icon" variant="ghost" title="Waktu berikutnya" aria-label="Waktu berikutnya" onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: "smooth" })}><ChevronRight /></Button></div>
    </div>
    <div ref={scrollRef} className="schedule-scroll overflow-auto border border-border bg-background" aria-label="Tabel dan diagram jadwal">
      <div ref={printRef} className="relative" style={{ width: totalWidth, minHeight: 350 }}>
        <div className="sticky top-0 z-20 flex border-b border-border bg-surface" style={{ height: 70 }}>
          {!showTable && <div className="shrink-0" style={{ width: timelineLeft }} />}
          {showTable && <div className={`schedule-table-grid ${settings.costs ? "schedule-table-costs" : ""} shrink-0 items-center text-xs font-semibold`} style={{ width: tableWidth }} role="row">{["ID", "WBS", "Judul pekerjaan", "Penanggung jawab", "Tanggal mulai", "Tenggat", "Durasi", "Predecessor", "% Selesai", "Status", "Komponen", "Aktual mulai", "Aktual selesai", "Progres", ...(settings.costs ? ["Biaya (Rp)"] : []), "Bobot", ""].map((label, i) => <div key={i} className="px-2" role="columnheader">{label}</div>)}</div>}
          {showTimeline && <div className="relative shrink-0 overflow-hidden" style={{ width: timelineWidth }}>{months.map((month) => <div key={month.toISOString()} className="absolute bottom-0 top-0 border-l border-border px-3 py-3" style={{ left: offset(month), width: (differenceInCalendarDays(endOfMonth(month), month) + 1) * dayWidth }}><span className="block text-xs text-muted-foreground">{format(month, "yyyy")}</span><span className="text-sm font-medium">{format(month, "MMM", { locale: localeId })}</span></div>)}{scale === "week" && Array.from({ length: Math.ceil(days / 7) }, (_, n) => <span key={n} className="absolute bottom-1 text-[10px] text-muted-foreground" style={{ left: n * 7 * dayWidth + 5 }}>{format(addDays(dates.start, n * 7), "d MMM", { locale: localeId })}</span>)}</div>}
        </div>
        {showTimeline && <div className="pointer-events-none absolute top-[70px]" style={{ left: timelineLeft, width: timelineWidth, height: visibleTasks.length * SCHEDULE_ROW_HEIGHT }}>{months.map((month) => <div key={month.toISOString()} className="schedule-month-line absolute bottom-0 top-0 border-l border-border" style={{ left: offset(month) }} />)}<div className="schedule-today absolute bottom-0 top-0 z-10" style={{ left: todayX }} title={format(today, "d MMMM yyyy", { locale: localeId })}><span className="schedule-today-dot" /></div></div>}
        {visibleTasks.map((task, rowIndex) => {
          const children = descendants(task, tasks);
          const summary = wbsLevel(task.wbs) === 1;
          const isCritical = settings.cpm && cpm.critical.has(task.id);
          const progress = scheduleProgress(task, tasks, format(today, "yyyy-MM-dd"));
          const bar = scheduleBarBounds(task, dates.start, dayWidth);
          const actualRanges = children.length ? [] : actualBarRanges(task, format(today, "yyyy-MM-dd"), progress);
          const delay = children.length || actualRanges.length ? null : delayBarRange(task, format(today, "yyyy-MM-dd"), progress);
          const delayLeft = delay ? differenceInCalendarDays(parseISO(delay.start), dates.start) * dayWidth : 0;
          const delayWidth = delay ? (differenceInCalendarDays(parseISO(delay.end), parseISO(delay.start)) + 1) * dayWidth : 0;
          return <div key={task.id} className={`relative flex ${task.stage ? "bg-muted/70" : ""}`} style={{ height: SCHEDULE_ROW_HEIGHT }} data-task-id={task.id}>
            {!showTable && <div className="flex shrink-0 items-center bg-surface px-2 text-xs" style={{ width: timelineLeft }}><span className="truncate">{task.wbs} {task.title}</span></div>}
            {showTable && <div className={`schedule-table-grid ${settings.costs ? "schedule-table-costs" : ""} shrink-0 items-center border-b border-border/60 text-xs`} style={{ width: tableWidth }}>
              <div className="px-2 text-muted-foreground">{task.taskNumber}</div>
              <div className="relative h-full flex items-start pt-1 px-1" style={{ paddingLeft: 4 + (wbsLevel(task.wbs) - 1) * 10 }}><span className={`schedule-wbs-level-${wbsLevel(task.wbs)} inline-block rounded px-2 py-1.5 font-semibold`} title={WBS_LEVEL_LABELS[wbsLevel(task.wbs)]}>{task.wbs}</span>{children.length > 0 && <Button size="icon" variant="ghost" className="absolute bottom-0 left-1 size-5" aria-label={`${settings.collapsed.includes(task.id) ? "Buka" : "Sembunyikan"} detail ${task.title}`} title="Buka / sembunyikan hierarki" aria-expanded={!settings.collapsed.includes(task.id)} onClick={() => toggleHierarchy(task)}>{settings.collapsed.includes(task.id) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</Button>}</div>
              <div className="flex h-full items-center px-1.5 py-1"><ScheduleTitlePicker value={task.title} label={`Judul pekerjaan ${task.wbs}`} summary={summary} templates={templates} onManual={(title) => { if (title.trim() && title.trim() !== task.title) commit(tasks.map((item) => item.id === task.id ? { ...item, title: title.trim() } : item)); }} onTemplate={(template) => setTemplateChoice({ template, targetId: task.id, start: task.start })} /></div>
              <div className="truncate px-2" title={task.owner}>{task.owner || "—"}</div>{dateCell(task, "start", rowIndex)}{dateCell(task, "due", rowIndex)}<div className="px-2">{scheduleDuration(task.start, task.due)} hari</div><div className="px-1"><Input key={predecessorText(task, tasks)} className="h-8 text-xs" aria-label={`Predecessor ${task.title}`} title={predecessorText(task, tasks)} defaultValue={predecessorText(task, tasks)} placeholder="—" onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const text = event.currentTarget.value; if (text === predecessorText(task, tasks)) return; try { const predecessors = parsePredecessors(text, task, tasks); if (!commit(tasks.map((t) => t.id === task.id ? { ...t, predecessor: undefined, predecessors } : t))) event.currentTarget.value = predecessorText(task, tasks); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Hubungan tidak valid."); event.currentTarget.value = predecessorText(task, tasks); } }} /></div><div className="px-2 font-semibold text-primary">{progress}%</div><div className="px-1"><span className={`schedule-status schedule-status-${task.status}`}>{STATUS_LABELS[task.status]}</span></div><div className="truncate px-2" title={task.component}>{task.component || "—"}</div>{dateCell(task, "actualStart", rowIndex)}{dateCell(task, "actualFinish", rowIndex)}<div className="px-2"><div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Progres ${task.title}`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-primary" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-[10px] text-muted-foreground">{progress}%</p></div>{settings.costs && <div className="px-2"><Input key={`${task.cost}-${costs.get(task.id)}`} aria-label={`Biaya ${task.title}`} title={`${formatScheduleCost(costs.get(task.id) ?? 0)}${task.cost === undefined ? " · Otomatis" : " · Manual"}`} type="number" min={0} step="any" className={`h-8 text-xs tabular-nums ${task.cost === undefined ? "text-muted-foreground" : "font-semibold"}`} defaultValue={costs.get(task.id) ?? ""} placeholder="—" onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const text = event.currentTarget.value.trim(); if (text === String(costs.get(task.id) ?? "")) return; try { commit(editScheduleCost(tasks, task.id, text ? Number(text) : undefined, settings.projectCost)); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Biaya tidak valid."); event.currentTarget.value = String(costs.get(task.id) ?? ""); } }} /></div>}<div className="px-2">{isWeightRoot(task) && !(hasProjectCost(settings.projectCost) && costs.has(task.id)) ? <div className="flex items-center gap-1"><Input key={task.weight ?? 0} aria-label={`Bobot ${task.title}`} type="number" min={0} max={100} step="any" className="h-8 min-w-0 text-xs" defaultValue={task.weight ?? 0} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => { const value = Number(event.currentTarget.value); if (!Number.isFinite(value) || value < 0 || value > 100) { toast.error("Bobot harus antara 0–100%."); event.currentTarget.value = String(task.weight ?? 0); return; } if (value !== (task.weight ?? 0)) commit(tasks.map((item) => item.id === task.id ? { ...item, weight: value } : item)); }} /><span>%</span></div> : <span className="font-semibold tabular-nums" aria-label={`Bobot ${task.title}`}>{formatScheduleWeight(weights.get(task.id) ?? 0)}</span>}</div><Button size="icon" variant="ghost" className="size-7 print:hidden" aria-label={`Edit ${task.title}`} onClick={() => { openTask(task); }}><Pencil className="size-3.5" /></Button>
            </div>}
            {showTimeline && <div className="relative shrink-0 overflow-hidden" style={{ width: timelineWidth }}>{settings.weights ? weeklyTaskWeights(task, weights.get(task.id) ?? 0).map((week) => <Button key={week.start} variant="ghost" className={`schedule-week-weight schedule-color-${summary ? "stage" : task.color} ${isCritical ? "schedule-critical-bar" : ""} absolute top-3 z-10 h-8 rounded px-0 text-[10px] font-semibold tabular-nums`} style={{ left: offset(parseISO(week.start)), width: Math.max(dayWidth, week.days * dayWidth) - 1 }} aria-label={`Bobot mingguan ${task.title} ${week.start}`} title={`${task.title} · ${format(parseISO(week.start), "d MMM yyyy", { locale: localeId })} · ${formatScheduleWeight(week.weight)}`} onClick={() => openTask(task)}>{formatScheduleWeight(week.weight)}</Button>) : <Button variant="ghost" className={`schedule-bar schedule-color-${summary ? "stage" : task.color} ${summary ? "schedule-summary-bar" : ""} ${isCritical ? "schedule-critical-bar" : ""} absolute top-3 z-10 h-8 justify-start rounded-lg p-0 text-left text-xs font-normal`} style={{ left: bar.left, width: bar.right - bar.left }} onClick={() => { openTask(task); }} aria-label={`Jadwal ${task.title}`} title={`${task.wbs} · ${task.title} · ${progress}%`}><span className="schedule-bar-progress absolute inset-y-0 left-0" style={{ width: `${progress}%` }} /><span className="relative truncate px-2">{task.title}</span></Button>}{settings.weights && weeklyActualWeights(task, weights.get(task.id) ?? 0, tasks, format(today, "yyyy-MM-dd")).map((week) => <span key={`a-${week.start}`} className="schedule-week-actual" style={{ left: offset(parseISO(week.start)), width: Math.max(dayWidth, week.days * dayWidth) - 1 }} aria-label={`Bobot realisasi ${task.title} ${week.start}`} title={`Realisasi ${task.title} · minggu ${format(parseISO(week.start), "d MMM yyyy", { locale: localeId })} · ${formatScheduleWeight(week.progress)} dari bobot ${formatScheduleWeight(weights.get(task.id) ?? 0)} = ${formatScheduleWeight(week.weight)}`}><svg className="absolute inset-0 h-full w-full" aria-hidden="true" viewBox={`0 0 ${Math.max(dayWidth, week.days * dayWidth) - 1} 10`} preserveAspectRatio="none"><ScheduleActualWeightFill start={week.start} days={week.days} due={task.due} width={Math.max(dayWidth, week.days * dayWidth) - 1} height={10} /></svg><span className="relative">{formatScheduleWeight(week.weight)}</span></span>)}{!settings.weights && delay && <span className="schedule-delay-bar" style={{ left: delayLeft, width: delayWidth }} title={`Terlambat hingga ${format(parseISO(delay.end), "d MMM yyyy", { locale: localeId })}`} />}{!settings.weights && actualRanges.map((range) => <span key={`${range.start}-${range.late}`} className={`schedule-actual-bar ${range.late ? "schedule-actual-bar-late" : ""}`} data-actual-late={range.late} style={{ left: offset(parseISO(range.start)), width: Math.max(4, (differenceInCalendarDays(parseISO(range.end), parseISO(range.start)) + (range.late || range.end < task.due ? 1 : 0)) * dayWidth) }} title={`Aktual ${task.title}: ${range.start} – ${range.end}${range.late ? " · Terlambat" : ""}`} />)}{children.length > 0 && !showTable && <Button variant="ghost" size="icon" className="absolute bottom-0 z-10 size-5" style={{ left: bar.left }} aria-label={`${settings.collapsed.includes(task.id) ? "Buka" : "Sembunyikan"} detail ${task.title}`} aria-expanded={!settings.collapsed.includes(task.id)} onClick={() => toggleHierarchy(task)}>{settings.collapsed.includes(task.id) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}</Button>}</div>}
          </div>;
        })}
        {showTimeline && <ScheduleDependencyLinks tasks={visibleTasks} critical={settings.cpm ? cpm.critical : undefined} start={dates.start} dayWidth={dayWidth} width={timelineWidth} left={timelineLeft} />}
        {showTimeline && tasks.length > 0 && <ScheduleWeeklySummary summary={weeklySummary} labelWidth={timelineLeft} width={timelineWidth} dayWidth={dayWidth} offset={(start) => offset(parseISO(start))} />}
        {!tasks.length && <div className="flex h-64 flex-col items-start justify-center gap-4 px-8"><ListChecks className="size-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">{activeId ? "Belum ada pekerjaan pada jadwal ini." : "Pilih sketsa untuk mengelola jadwalnya."}</p>{activeSchedule && <Button variant="outline" onClick={() => newTask()}><Plus />Tambah pekerjaan</Button>}</div>}
      </div>
    </div>
    {showTimeline && tasks.some((task) => taskPredecessors(task).length > 0) && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs print:hidden" aria-label="Legenda hubungan predecessor">{PREDECESSOR_TYPES.map((type) => <span key={type} className={`schedule-link-${type} flex items-center gap-2`} title={PREDECESSOR_LABELS[type]}><span className="schedule-link-key h-0.5 w-5" /><span>{type} · {PREDECESSOR_LABELS[type]}</span></span>)}</div>}
    <footer className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground print:hidden">{([1, 2, 3, 4] as const).map((level) => <span key={level} className="flex items-center gap-2"><span className={`schedule-wbs-level-${level} rounded px-1.5 py-0.5 text-[10px] font-semibold`}>{["1", "1.1", "1.1.1", "1.1.1.1"][level - 1]}</span>{WBS_LEVEL_LABELS[level]}</span>)}<span className="h-4 w-px bg-border" />{SCHEDULE_COLORS.map((color) => <span key={color} className="flex items-center gap-2"><span className={`schedule-color-${color} size-3 rounded-sm`} />{COLOR_LABELS[color]}</span>)}<span className="flex items-center gap-2"><span className="schedule-delay-key" />Terlambat</span><span className="flex items-center gap-2"><span className="schedule-actual-key" />Aktual</span><span className="ml-auto flex items-center gap-2"><span className="schedule-today-key h-3 w-0.5" />Hari ini</span></footer>
    <ScheduleSCurve key={activeSchedule?.id ?? "empty"} tasks={tasks} today={today} weights={weights} showWeights={settings.weights === true} critical={settings.cpm ? cpm.critical : undefined} />
    </div>

    <Dialog open={!!draft} onOpenChange={(open) => { if (!open) setDraft(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{draft && tasks.some((t) => t.id === draft.id) ? "Edit pekerjaan" : draft?.stage ? "Tambah tahap" : "Tambah pekerjaan"}</DialogTitle></DialogHeader>{draft && <form onSubmit={(e) => { e.preventDefault(); saveDraft(); }} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="wbs">Nomor WBS</Label><Input id="wbs" value={draft.wbs} onChange={(e) => update({ wbs: e.target.value })} placeholder="1.1" /></div><div className="space-y-2"><Label htmlFor="owner">Penanggung jawab</Label><Input id="owner" value={draft.owner} onChange={(e) => update({ owner: e.target.value })} /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="task-title">Judul pekerjaan</Label><Input id="task-title" value={draft.title} onChange={(e) => update({ title: e.target.value })} /></div><div className="space-y-2"><Label>Tanggal mulai</Label><ScheduleDatePicker label="Tanggal mulai" value={draft.start} onChange={(start) => update({ start, due: scheduleDue(start, scheduleDuration(draft.start, draft.due)) })} /></div><div className="space-y-2"><Label>Tenggat</Label><ScheduleDatePicker label="Tenggat" value={draft.due} min={draft.start} onChange={(due) => update({ due })} /></div><div className="space-y-2"><Label htmlFor="duration">Durasi (hari)</Label><Input id="duration" type="number" min={0} max={36500} value={scheduleDuration(draft.start, draft.due)} onChange={(e) => update({ due: scheduleDue(draft.start, Math.min(36500, Number(e.target.value))) })} /></div><div className="space-y-2"><Label>Status</Label><Select value={draft.status} onValueChange={(status) => update({ status: status as ScheduleTask["status"] })}><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger><SelectContent>{SCHEDULE_STATUSES.map((status) => <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="component">Komponen</Label><Input id="component" value={draft.component} onChange={(e) => update({ component: e.target.value })} /></div>{(["actualStart", "actualFinish"] as const).map((field) => <div key={field} className="space-y-2"><Label>{SCHEDULE_DATE_LABELS[field]}</Label><ScheduleDatePicker label={SCHEDULE_DATE_LABELS[field]} value={draft[field] ?? ""} clearable min={field === "actualFinish" ? draft.actualStart : undefined} onChange={(value) => update({ [field]: value || undefined })} /></div>)}<div className="space-y-2"><Label>Warna bar</Label><ToggleGroup type="single" value={draft.color} onValueChange={(color) => { if (color) update({ color: color as ScheduleTask["color"] }); }} className="justify-start" aria-label="Warna bar">{SCHEDULE_COLORS.map((color) => <ToggleGroupItem key={color} value={color} aria-label={COLOR_LABELS[color]} title={COLOR_LABELS[color]} className="size-9 p-1 data-[state=on]:ring-2 data-[state=on]:ring-ring"><span className={`schedule-color-${color} size-5 rounded`} /></ToggleGroupItem>)}</ToggleGroup></div></div>
      <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="predecessor">Predecessor</Label><Input id="predecessor" value={predecessorInput} placeholder="2;3;4FS atau 2SS+1;3FS-2" onChange={(event) => { const value = event.target.value; setPredecessorInput(value); const code = /(FS|SS|FF|SF)(?=\s*[+-]\s*\d+$|$)/i.exec(value.trim())?.[1]?.toUpperCase(); if (code) setPredecessorType(code as PredecessorType); }} list="predecessor-options" /><datalist id="predecessor-options">{tasks.filter((task) => task.id !== draft.id).map((task) => <option key={task.id} value={`${task.taskNumber}${predecessorType}`}>{task.title}</option>)}</datalist></div><div className="space-y-2"><Label>Jenis hubungan</Label><Select value={predecessorType} onValueChange={(type) => { setPredecessorType(type as PredecessorType); setPredecessorInput((current) => !current.includes(";") && current.trim() ? current.replace(/^(\d+)\s*(?:FS|SS|FF|SF)?(.*)$/i, `$1${type}$2`) : current); }}><SelectTrigger aria-label="Jenis hubungan"><SelectValue /></SelectTrigger><SelectContent>{PREDECESSOR_TYPES.map((type) => <SelectItem key={type} value={type}>{type} · {PREDECESSOR_LABELS[type]}</SelectItem>)}</SelectContent></Select></div></div>
      <div className="flex items-center gap-2"><Checkbox id="is-stage" checked={draft.stage} onCheckedChange={(checked) => update({ stage: checked === true })} /><Label htmlFor="is-stage">Tahap / kelompok WBS</Label></div>
      {descendants(draft, tasks).length ? <p className="border-t border-border pt-4 text-xs text-muted-foreground">Progres kelompok mengikuti rincian pekerjaan.</p> : <ScheduleTaskProgress key={draft.id} task={draft} today={today} onChange={(progressEntries) => update({ progressEntries })} />}
      <section className="border-t border-border pt-4"><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><CheckCheck className="size-4 text-primary" />Subpekerjaan</h2><span className="text-sm font-semibold text-primary">{scheduleProgress(draft, tasks.map((t) => t.id === draft.id ? draft : t))}%</span></div><div className="space-y-2">{draft.checks.map((check, index) => <div key={check.id} className="flex items-center gap-2"><Checkbox checked={check.done} aria-label={`Selesai ${check.title || `subpekerjaan ${index + 1}`}`} onCheckedChange={(done) => update({ checks: draft.checks.map((c) => c.id === check.id ? { ...c, done: done === true } : c) })} /><Input aria-label={`Subpekerjaan ${index + 1}`} value={check.title} onChange={(e) => update({ checks: draft.checks.map((c) => c.id === check.id ? { ...c, title: e.target.value } : c) })} /><Button type="button" variant="ghost" size="icon" aria-label={`Hapus subpekerjaan ${index + 1}`} onClick={() => update({ checks: draft.checks.filter((c) => c.id !== check.id) })}><Trash2 className="size-4" /></Button></div>)}</div><Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => update({ checks: [...draft.checks, { id: crypto.randomUUID(), title: "", done: false }] })}><Plus />Subpekerjaan</Button></section>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="gap-2">{tasks.some((t) => t.id === draft.id) && <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => setDeleting(draft)}><Trash2 />Hapus</Button>}<Button type="button" variant="outline" onClick={() => setDraft(null)}>Batal</Button><Button type="submit">Simpan</Button></DialogFooter>
    </form>}</DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Hapus pekerjaan?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{deleting?.title}</p><DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Batal</Button><Button variant="destructive" onClick={() => { if (commit(tasks.filter((t) => t.id !== deleting?.id))) { setDeleting(null); setDraft(null); } }}>Hapus</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={deletingSchedule} onOpenChange={setDeletingSchedule}><AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg"><AlertDialogHeader><AlertDialogTitle>Hapus jadwal?</AlertDialogTitle><AlertDialogDescription>Jadwal “{activeSchedule?.name}” beserta seluruh pekerjaan, progres, bobot, dan pengaturannya akan dihapus. Tindakan ini tidak dapat dibatalkan. Sketsa dan jadwal lainnya tetap tersimpan.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" onClick={() => setDeletingSchedule(false)}>Batal</Button><Button variant="destructive" onClick={removeSchedule}>Ya, hapus jadwal</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!templateChoice} onOpenChange={(open) => { if (!open) setTemplateChoice(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Terapkan template pekerjaan?</AlertDialogTitle><AlertDialogDescription>{templateChoice?.targetId ? "Seluruh judul, durasi, dan predecessor pada kelompok WBS utama pekerjaan ini beserta turunannya akan diganti sesuai template. Rincian lama yang tidak ada dalam template akan dihapus." : "Seluruh hierarki template akan ditambahkan sebagai kelompok WBS utama berikutnya."} Nomor WBS dan ID predecessor mengikuti jadwal ini.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" onClick={() => setTemplateChoice(null)}>Batal</Button><Button onClick={applyTemplate}>Terapkan template</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
