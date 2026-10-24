import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, eachMonthOfInterval, format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { CalendarDays, CheckCheck, ChevronLeft, ChevronRight, ListChecks, Pencil, PenTool, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScheduleDatePicker } from "@/components/schedule-date-picker";
import { SCHEDULE_KEY, SCHEDULE_COLORS, SCHEDULE_STATUSES, SKETCH_STORE_KEY, WBS_LEVEL_LABELS, normalizeScheduleStore, readSketchStore, scheduleDue, scheduleDuration, scheduleProgress, totalScheduleProgress, wbsLevel, type ScheduleStore, type ScheduleTask, type SketchRef } from "@/lib/schedule";
import { setProjectItem } from "@/lib/storage/idb-bridge";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/jadwal")({
  component: SchedulePage,
  head: () => ({ meta: [
    { title: "Jadwal — Pekerjaan & Progres | Dabidabi's" },
    { name: "description", content: "Kelola WBS, jadwal pekerjaan, penanggung jawab, dan progres subpekerjaan per sketsa dalam tabel dan diagram Gantt privat Dabidabi's." },
    { property: "og:title", content: "Jadwal — Pekerjaan & Progres | Dabidabi's" },
    { property: "og:description", content: "Jadwal proyek per sketsa dengan bar waktu, progres ceklis, dan penanda hari berjalan." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
});

const STATUS_LABELS = { belum: "Belum mulai", berjalan: "Berjalan", berisiko: "Berisiko", tertunda: "Tertunda", selesai: "Selesai" };
const COLOR_LABELS = { stage: "Jingga", lavender: "Lavender", green: "Hijau", yellow: "Kuning", neutral: "Netral" };
const TABLE_WIDTH = 1180;

function SchedulePage() {
  const { user } = useAuth();
  return user ? <ScheduleWorkspace key={user.id} /> : null;
}

function ScheduleWorkspace() {
  const [sketches, setSketches] = useState<SketchRef[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [store, setStore] = useState<ScheduleStore>({});
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState(() => new Date());
  const [view, setView] = useState("combined");
  const [scale, setScale] = useState("month");
  const [draft, setDraft] = useState<ScheduleTask | null>(null);
  const [deleting, setDeleting] = useState<ScheduleTask | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const queue = useRef(Promise.resolve());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function load() {
      try {
        const sketchStore = readSketchStore(localStorage.getItem(SKETCH_STORE_KEY));
        setSketches(sketchStore.sketches);
        const fallbackId = sketchStore.openId && sketchStore.sketches.some((s) => s.id === sketchStore.openId) ? sketchStore.openId : sketchStore.sketches[0]?.id ?? null;
        setActiveId((current) => current && sketchStore.sketches.some((s) => s.id === current) ? current : fallbackId);
        setStore(normalizeScheduleStore(JSON.parse(localStorage.getItem(SCHEDULE_KEY) || "null"), fallbackId));
      } catch { toast.error("Data jadwal tidak dapat dibaca."); }
      setReady(true);
    }
    load();
    const onStorage = (event: StorageEvent) => { if (event.key === SKETCH_STORE_KEY) load(); };
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(() => setToday(new Date()), 60_000);
    return () => { window.removeEventListener("storage", onStorage); window.clearInterval(timer); };
  }, []);

  const tasks = activeId ? store[activeId] ?? [] : [];
  const activeSketch = sketches.find((s) => s.id === activeId) ?? null;

  function commit(next: ScheduleTask[]) {
    if (!activeId) return;
    const nextStore = { ...store, [activeId]: next };
    setStore(nextStore);
    setSaving(true);
    const write = queue.current.catch(() => {}).then(() => setProjectItem(SCHEDULE_KEY, JSON.stringify(nextStore)));
    queue.current = write;
    void write.then(() => { if (queue.current === write) setSaving(false); }, () => { setSaving(false); toast.error("Jadwal belum tersimpan. Silakan coba lagi."); });
  }

  function newTask(stage = false) {
    const date = format(today, "yyyy-MM-dd");
    setError("");
    setDraft({ id: crypto.randomUUID(), wbs: "", title: "", owner: "", start: date, due: scheduleDue(date, 7), status: "belum", component: "", color: stage ? "stage" : "lavender", stage, checks: [] });
  }

  const dates = useMemo(() => {
    const current = format(today, "yyyy-MM-dd");
    const first = [current, ...tasks.map((t) => t.start)].sort()[0];
    const last = [current, ...tasks.map((t) => t.due)].sort().at(-1) || current;
    return { start: startOfMonth(parseISO(first)), end: endOfMonth(addDays(parseISO(last), 14)) };
  }, [tasks, today]);
  const dayWidth = scale === "week" ? 22 : 6;
  const days = differenceInCalendarDays(dates.end, dates.start) + 1;
  const timelineWidth = Math.max(720, days * dayWidth);
  const offset = (date: Date) => differenceInCalendarDays(date, dates.start) * dayWidth;
  const months = eachMonthOfInterval(dates);
  const showTable = view !== "timeline";
  const showTimeline = view !== "table";
  const totalWidth = (showTable ? TABLE_WIDTH : 0) + (showTimeline ? timelineWidth : 0);
  const todayX = offset(today) + dayWidth / 2;
  const percentage = totalScheduleProgress(tasks);

  function goToday() {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTo({ left: (showTable ? TABLE_WIDTH : 0) + todayX - scroll.clientWidth / 2, behavior: "smooth" });
  }
  function saveDraft() {
    if (!draft) return;
    if (!draft.wbs.trim() || !draft.title.trim()) { setError("Isi nomor WBS dan judul pekerjaan."); return; }
    if (tasks.some((t) => t.id !== draft.id && t.wbs.trim() === draft.wbs.trim())) { setError("Nomor WBS sudah dipakai pekerjaan lain."); return; }
    if (draft.due < draft.start) { setError("Tenggat tidak boleh sebelum tanggal mulai."); return; }
    const clean = { ...draft, title: draft.title.trim(), wbs: draft.wbs.trim(), checks: draft.checks.filter((c) => c.title.trim()).map((c) => ({ ...c, title: c.title.trim() })) };
    commit(tasks.some((t) => t.id === draft.id) ? tasks.map((t) => t.id === draft.id ? clean : t) : [...tasks, clean].sort((a, b) => a.wbs.localeCompare(b.wbs, undefined, { numeric: true })));
    setDraft(null);
  }
  const update = (value: Partial<ScheduleTask>) => setDraft((current) => current ? { ...current, ...value } : null);

  return <main className="schedule-page flex gap-6 px-4 py-7 sm:px-6">
    <aside className="w-52 shrink-0" aria-label="Daftar sketsa">
      <p className="mb-3 text-xs font-medium uppercase text-ember">Sketsa</p>
      <div className="space-y-1">
        {sketches.map((sketch) => {
          const list = store[sketch.id] ?? [];
          const pct = totalScheduleProgress(list);
          const active = sketch.id === activeId;
          return <button key={sketch.id} type="button" onClick={() => { setActiveId(sketch.id); setDraft(null); setDeleting(null); }} aria-current={active ? "true" : undefined} className={`flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted/60"}`}>
            <span className="truncate text-sm font-medium" title={sketch.title}>{sketch.title}</span>
            <span className="text-[11px] text-muted-foreground">{list.length} pekerjaan · {pct}%</span>
          </button>;
        })}
      </div>
      {!sketches.length && ready && <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground"><p>Belum ada sketsa.</p><Link to="/sketch" className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"><PenTool className="size-3" />Buka halaman Sketsa</Link></div>}
    </aside>

    <div className="min-w-0 flex-1">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><p className="mb-2 text-xs font-medium uppercase text-ember">Project · Jadwal</p><h1 className="font-display text-3xl font-semibold">Jadwal</h1><p className="mt-2 text-sm text-muted-foreground">{activeSketch ? <span className="font-medium text-foreground">{activeSketch.title}</span> : "Tanpa sketsa"}<span className="mx-2">·</span>{format(today, "EEEE, d MMMM yyyy", { locale: localeId })}<span className="mx-2">·</span>{tasks.length} pekerjaan<span className="mx-2">·</span>{saving ? "Menyimpan…" : "Tersimpan"}</p></div>
      <div className="flex items-center gap-5"><div className="text-right"><p className="text-xs text-muted-foreground">Progres keseluruhan</p><p className="mt-1 font-display text-3xl font-semibold text-primary">{percentage}%</p></div><div className="h-10 w-px bg-border" /><Button variant="outline" onClick={() => newTask(true)} disabled={!ready || !activeId}><Plus />Tahap</Button><Button onClick={() => newTask()} disabled={!ready || !activeId}><Plus />Pekerjaan</Button></div>
    </header>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
      <ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v); }} aria-label="Tampilan jadwal"><ToggleGroupItem value="combined">Tabel & Gantt</ToggleGroupItem><ToggleGroupItem value="table">Tabel</ToggleGroupItem><ToggleGroupItem value="timeline">Gantt</ToggleGroupItem></ToggleGroup>
      <div className="flex items-center gap-2"><ToggleGroup type="single" value={scale} onValueChange={(v) => { if (v) setScale(v); }} aria-label="Skala waktu"><ToggleGroupItem value="week">Minggu</ToggleGroupItem><ToggleGroupItem value="month">Bulan</ToggleGroupItem></ToggleGroup><Button size="icon" variant="ghost" title="Waktu sebelumnya" aria-label="Waktu sebelumnya" onClick={() => scrollRef.current?.scrollBy({ left: -300, behavior: "smooth" })}><ChevronLeft /></Button><Button variant="outline" onClick={goToday}><CalendarDays />Hari ini</Button><Button size="icon" variant="ghost" title="Waktu berikutnya" aria-label="Waktu berikutnya" onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: "smooth" })}><ChevronRight /></Button></div>
    </div>
    <div ref={scrollRef} className="schedule-scroll overflow-auto border border-border bg-background" aria-label="Tabel dan diagram jadwal">
      <div className="relative" style={{ width: totalWidth, minHeight: 350 }}>
        <div className="sticky top-0 z-20 flex border-b border-border bg-surface" style={{ height: 70 }}>
          {showTable && <div className="schedule-table-grid shrink-0 items-center text-xs font-semibold" style={{ width: TABLE_WIDTH }} role="row">{["WBS", "Judul pekerjaan", "Penanggung jawab", "Tanggal mulai", "Tenggat", "Durasi", "% Selesai", "Status", "Komponen", "Progres", ""].map((label, i) => <div key={i} className="px-2" role="columnheader">{label}</div>)}</div>}
          {showTimeline && <div className="relative shrink-0 overflow-hidden" style={{ width: timelineWidth }}>{months.map((month) => <div key={month.toISOString()} className="absolute bottom-0 top-0 border-l border-border px-3 py-3" style={{ left: offset(month), width: (differenceInCalendarDays(endOfMonth(month), month) + 1) * dayWidth }}><span className="block text-xs text-muted-foreground">{format(month, "yyyy")}</span><span className="text-sm font-medium">{format(month, "MMM", { locale: localeId })}</span></div>)}{scale === "week" && Array.from({ length: Math.ceil(days / 7) }, (_, n) => <span key={n} className="absolute bottom-1 text-[10px] text-muted-foreground" style={{ left: n * 7 * dayWidth + 5 }}>{format(addDays(dates.start, n * 7), "d MMM", { locale: localeId })}</span>)}</div>}
        </div>
        {showTimeline && <div className="pointer-events-none absolute bottom-0 top-[70px]" style={{ left: showTable ? TABLE_WIDTH : 0, width: timelineWidth }}>{months.map((month) => <div key={month.toISOString()} className="absolute bottom-0 top-0 border-l border-border" style={{ left: offset(month) }} />)}<div className="schedule-today absolute bottom-0 top-0 z-10" style={{ left: todayX }} title={format(today, "d MMMM yyyy", { locale: localeId })}><span className="schedule-today-dot" /></div></div>}
        {tasks.map((task) => {
          const progress = scheduleProgress(task, tasks);
          return <div key={task.id} className={`relative flex border-b border-border/60 ${task.stage ? "bg-muted/70" : ""}`} style={{ height: 58 }} data-task-id={task.id}>
            {showTable && <div className="schedule-table-grid shrink-0 items-center text-xs" style={{ width: TABLE_WIDTH }}>
              <div className="px-1" style={{ paddingLeft: 4 + (wbsLevel(task.wbs) - 1) * 10 }}><span className={`schedule-wbs schedule-wbs-level-${wbsLevel(task.wbs)} inline-block rounded px-2 py-1.5 font-semibold`} title={WBS_LEVEL_LABELS[wbsLevel(task.wbs)]}>{task.wbs}</span></div>
              <Button variant="ghost" className={`h-full justify-start whitespace-normal px-2 text-left text-xs ${task.stage ? "font-semibold" : "font-normal"}`} onClick={() => { setError(""); setDraft(structuredClone(task)); }} title={task.title}><span className="line-clamp-2">{task.title}</span></Button>
              <div className="truncate px-2" title={task.owner}>{task.owner || "—"}</div><div className="px-2">{format(parseISO(task.start), "d/M/yy")}</div><div className="px-2">{format(parseISO(task.due), "d/M/yy")}</div><div className="px-2">{scheduleDuration(task.start, task.due)} hari</div><div className="px-2 font-semibold text-primary">{progress}%</div><div className="px-1"><span className={`schedule-status schedule-status-${task.status}`}>{STATUS_LABELS[task.status]}</span></div><div className="truncate px-2" title={task.component}>{task.component || "—"}</div><div className="px-2"><div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Progres ${task.title}`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-primary" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-[10px] text-muted-foreground">{progress}%</p></div><Button size="icon" variant="ghost" className="size-7" aria-label={`Edit ${task.title}`} onClick={() => { setError(""); setDraft(structuredClone(task)); }}><Pencil className="size-3.5" /></Button>
            </div>}
            {showTimeline && <div className="relative shrink-0 overflow-hidden" style={{ width: timelineWidth }}><Button variant="ghost" className={`schedule-bar schedule-color-${task.color} absolute top-3 h-8 justify-start rounded-lg p-0 text-left text-xs font-normal`} style={{ left: offset(parseISO(task.start)) + 2, width: Math.max(8, (scheduleDuration(task.start, task.due) + 1) * dayWidth - 4) }} onClick={() => { setError(""); setDraft(structuredClone(task)); }} aria-label={`Jadwal ${task.title}`} title={`${task.wbs} · ${task.title} · ${progress}%`}><span className="schedule-bar-progress absolute inset-y-0 left-0" style={{ width: `${progress}%` }} /><span className="relative truncate px-2">{task.title}</span></Button></div>}
          </div>;
        })}
        {!tasks.length && <div className="flex h-64 flex-col items-start justify-center gap-4 px-8"><ListChecks className="size-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">{activeId ? "Belum ada pekerjaan pada sketsa ini." : "Pilih sketsa untuk mengelola jadwalnya."}</p>{activeId && <Button variant="outline" onClick={() => newTask()}><Plus />Tambah pekerjaan</Button>}</div>}
      </div>
    </div>
    <footer className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">{([1, 2, 3, 4] as const).map((level) => <span key={level} className="flex items-center gap-2"><span className={`schedule-wbs-level-${level} rounded px-1.5 py-0.5 text-[10px] font-semibold`}>{["1", "1.1", "1.1.1", "1.1.1.1"][level - 1]}</span>{WBS_LEVEL_LABELS[level]}</span>)}<span className="h-4 w-px bg-border" />{SCHEDULE_COLORS.map((color) => <span key={color} className="flex items-center gap-2"><span className={`schedule-color-${color} size-3 rounded-sm`} />{COLOR_LABELS[color]}</span>)}<span className="ml-auto flex items-center gap-2"><span className="schedule-today-key h-3 w-0.5" />Hari ini</span></footer>
    </div>

    <Dialog open={!!draft} onOpenChange={(open) => { if (!open) setDraft(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{draft && tasks.some((t) => t.id === draft.id) ? "Edit pekerjaan" : draft?.stage ? "Tambah tahap" : "Tambah pekerjaan"}</DialogTitle></DialogHeader>{draft && <form onSubmit={(e) => { e.preventDefault(); saveDraft(); }} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="wbs">Nomor WBS</Label><Input id="wbs" value={draft.wbs} onChange={(e) => update({ wbs: e.target.value })} placeholder="1.1" /></div><div className="space-y-2"><Label htmlFor="owner">Penanggung jawab</Label><Input id="owner" value={draft.owner} onChange={(e) => update({ owner: e.target.value })} /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="task-title">Judul pekerjaan</Label><Input id="task-title" value={draft.title} onChange={(e) => update({ title: e.target.value })} /></div><div className="space-y-2"><Label>Tanggal mulai</Label><ScheduleDatePicker label="Tanggal mulai" value={draft.start} onChange={(start) => update({ start, due: scheduleDue(start, scheduleDuration(draft.start, draft.due)) })} /></div><div className="space-y-2"><Label>Tenggat</Label><ScheduleDatePicker label="Tenggat" value={draft.due} min={draft.start} onChange={(due) => update({ due })} /></div><div className="space-y-2"><Label htmlFor="duration">Durasi (hari)</Label><Input id="duration" type="number" min={0} max={36500} value={scheduleDuration(draft.start, draft.due)} onChange={(e) => update({ due: scheduleDue(draft.start, Math.min(36500, Number(e.target.value))) })} /></div><div className="space-y-2"><Label>Status</Label><Select value={draft.status} onValueChange={(status) => update({ status: status as ScheduleTask["status"] })}><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger><SelectContent>{SCHEDULE_STATUSES.map((status) => <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="component">Komponen</Label><Input id="component" value={draft.component} onChange={(e) => update({ component: e.target.value })} /></div><div className="space-y-2"><Label>Warna bar</Label><ToggleGroup type="single" value={draft.color} onValueChange={(color) => { if (color) update({ color: color as ScheduleTask["color"] }); }} className="justify-start" aria-label="Warna bar">{SCHEDULE_COLORS.map((color) => <ToggleGroupItem key={color} value={color} aria-label={COLOR_LABELS[color]} title={COLOR_LABELS[color]} className="size-9 p-1 data-[state=on]:ring-2 data-[state=on]:ring-ring"><span className={`schedule-color-${color} size-5 rounded`} /></ToggleGroupItem>)}</ToggleGroup></div></div>
      <div className="flex items-center gap-2"><Checkbox id="is-stage" checked={draft.stage} onCheckedChange={(checked) => update({ stage: checked === true })} /><Label htmlFor="is-stage">Tahap / kelompok WBS</Label></div>
      <section className="border-t border-border pt-4"><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><CheckCheck className="size-4 text-primary" />Subpekerjaan</h2><span className="text-sm font-semibold text-primary">{scheduleProgress(draft, tasks.map((t) => t.id === draft.id ? draft : t))}%</span></div><div className="space-y-2">{draft.checks.map((check, index) => <div key={check.id} className="flex items-center gap-2"><Checkbox checked={check.done} aria-label={`Selesai ${check.title || `subpekerjaan ${index + 1}`}`} onCheckedChange={(done) => update({ checks: draft.checks.map((c) => c.id === check.id ? { ...c, done: done === true } : c) })} /><Input aria-label={`Subpekerjaan ${index + 1}`} value={check.title} onChange={(e) => update({ checks: draft.checks.map((c) => c.id === check.id ? { ...c, title: e.target.value } : c) })} /><Button type="button" variant="ghost" size="icon" aria-label={`Hapus subpekerjaan ${index + 1}`} onClick={() => update({ checks: draft.checks.filter((c) => c.id !== check.id) })}><Trash2 className="size-4" /></Button></div>)}</div><Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => update({ checks: [...draft.checks, { id: crypto.randomUUID(), title: "", done: false }] })}><Plus />Subpekerjaan</Button></section>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="gap-2">{tasks.some((t) => t.id === draft.id) && <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => setDeleting(draft)}><Trash2 />Hapus</Button>}<Button type="button" variant="outline" onClick={() => setDraft(null)}>Batal</Button><Button type="submit">Simpan</Button></DialogFooter>
    </form>}</DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Hapus pekerjaan?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">{deleting?.title}</p><DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Batal</Button><Button variant="destructive" onClick={() => { commit(tasks.filter((t) => t.id !== deleting?.id)); setDeleting(null); setDraft(null); }}>Hapus</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
