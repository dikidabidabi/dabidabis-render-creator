import { useState } from "react";
import { format, parseISO } from "date-fns";
import { id } from "date-fns/locale";
import { CalendarPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScheduleDatePicker } from "@/components/schedule-date-picker";
import { plannedProgress } from "@/lib/schedule-analysis";
import { upsertTaskProgress, type ScheduleTask, type TaskProgressEntry } from "@/lib/schedule";

export function ScheduleTaskProgress({ task, today, onChange }: { task: ScheduleTask; today: Date; onChange: (entries: TaskProgressEntry[]) => void }) {
  const [date, setDate] = useState(format(today, "yyyy-MM-dd"));
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const entries = task.progressEntries ?? [];
  function addEntry() {
    try {
      if (!actual.trim()) throw new Error("Isi persentase progres.");
      onChange(upsertTaskProgress(entries, { date, actual: Number(actual.replace(",", ".")), note }));
      setActual(""); setNote(""); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Progres tidak valid."); }
  }
  return <section className="space-y-3 border-t border-border pt-4" aria-label={`Progres bertanggal ${task.title}`}>
    <h2 className="text-sm font-semibold">Progres pekerjaan</h2>
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
      <div className="space-y-2"><Label>Tanggal pengisian progres</Label><ScheduleDatePicker label="Tanggal pengisian progres pekerjaan" value={date} onChange={setDate} /></div>
      <div className="space-y-2"><Label htmlFor="task-progress">Progres (%)</Label><Input id="task-progress" inputMode="decimal" placeholder="0–100" value={actual} onChange={(event) => setActual(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="task-progress-note">Catatan progres (opsional)</Label><Input id="task-progress-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
      <Button type="button" variant="outline" onClick={addEntry} disabled={!actual.trim()}><CalendarPlus />Tambahkan progres</Button>
    </div>
    <p className="text-xs text-muted-foreground">Rencana pada {format(parseISO(date), "d MMM yyyy", { locale: id })}: {plannedProgress([task], date).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%</p>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    {entries.length > 0 && <ul className="max-h-48 divide-y divide-border overflow-auto border-y border-border text-xs" aria-label="Riwayat progres pekerjaan">{[...entries].reverse().map((point) => <li key={point.date} className="flex items-center gap-3 py-2">
      <span className="w-24 shrink-0">{format(parseISO(point.date), "d MMM yyyy", { locale: id })}</span><span className="w-14 shrink-0 font-semibold text-primary">{point.actual}%</span><span className="min-w-0 flex-1 truncate text-muted-foreground" title={point.note}>{point.note || "—"}</span>
      <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Hapus progres ${point.date}`} onClick={() => onChange(entries.filter((entry) => entry.date !== point.date))}><Trash2 className="size-3.5" /></Button>
    </li>)}</ul>}
  </section>;
}