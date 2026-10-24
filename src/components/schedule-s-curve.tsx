import { useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { CalendarPlus, Trash2 } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScheduleDatePicker } from "@/components/schedule-date-picker";
import { plannedProgress, removeObservation, scheduleLeaves, upsertObservation, weightedProgress, type ProgressObservation } from "@/lib/schedule-analysis";
import { scheduleDuration, type ScheduleTask } from "@/lib/schedule";

export function ScheduleSCurve({ tasks, observations, today, onChange }: { tasks: ScheduleTask[]; observations: ProgressObservation[]; today: Date; onChange?: (observations: ProgressObservation[]) => void }) {
  const current = format(today, "yyyy-MM-dd");
  const [entryDate, setEntryDate] = useState(current);
  const [entryActual, setEntryActual] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const data = useMemo(() => {
    const leaves = scheduleLeaves(tasks);
    const start = leaves.map((task) => task.start).sort()[0];
    const end = leaves.map((task) => task.due).sort().at(-1);
    if (!start || !end) return [];
    const days = differenceInCalendarDays(parseISO(end), parseISO(start));
    const step = Math.max(7, Math.ceil(days / 260));
    const dates = new Set([start, end, current, ...leaves.flatMap((task) => [task.start, task.due]), ...observations.map((point) => point.date)]);
    for (let d = step; d < days; d += step) dates.add(format(addDays(parseISO(start), d), "yyyy-MM-dd"));
    return [...dates].sort().map((date) => {
      const observation = observations.filter((point) => point.date <= date).at(-1);
      return { date, time: parseISO(date).getTime(), plan: plannedProgress(tasks, date), actual: date === current ? weightedProgress(tasks) : date > current || !observation ? null : observation.actual };
    });
  }, [tasks, observations, current]);
  const plan = plannedProgress(tasks, current), actual = weightedProgress(tasks), deviation = actual - plan;
  const number = (value: number) => value.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  const leaves = scheduleLeaves(tasks);
  function saveEntry() {
    const value = Number(entryActual.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 100 || !onChange) return;
    onChange(upsertObservation(observations, { date: entryDate, actual: value, note: entryNote }));
    setEntryActual("");
    setEntryNote("");
  }
  return <section className="schedule-s-curve mt-7 rounded-lg border border-border bg-background p-4" aria-label="Kurva S">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-display text-xl font-semibold">Kurva S</h2><p className="mt-1 text-xs text-muted-foreground">Bobot durasi · {leaves.reduce((sum, task) => sum + Math.max(1, scheduleDuration(task.start, task.due)), 0)} hari-pekerjaan</p></div><dl className="flex flex-wrap gap-6 text-sm">{[["Rencana", number(plan) + "%"], ["Realisasi", number(actual) + "%"], ["Deviasi", (deviation > 0 ? "+" : "") + number(deviation) + "%"], ["SPI", plan ? number(actual / plan) : "—"]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 font-semibold ${label === "Deviasi" && deviation < 0 ? "text-destructive" : "text-foreground"}`}>{value}</dd></div>)}</dl></div>
    {!data.length ? <p className="py-12 text-center text-sm text-muted-foreground">Belum ada data jadwal.</p> : <>
      <div className="mt-5 h-80 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 15, right: 25, bottom: 15, left: 0 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(time: number) => format(new Date(time), "d/M/yy")} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} minTickGap={45} /><YAxis domain={[0, 100]} unit="%" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} /><Tooltip labelFormatter={(time) => format(new Date(Number(time)), "d MMM yyyy")} formatter={(value: number, name: string) => [`${number(value)}%`, name]} contentStyle={{ background: "var(--popover)", borderColor: "var(--border)", color: "var(--foreground)" }} /><Legend /><ReferenceLine x={parseISO(current).getTime()} stroke="var(--schedule-today)" strokeDasharray="4 4" /><Line dataKey="plan" name="Rencana" type="linear" stroke="var(--schedule-link-fs)" strokeWidth={2.5} dot={false} isAnimationActive={false} /><Line dataKey="actual" name="Realisasi" type="linear" stroke="var(--schedule-link-ss)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
      <div className="mt-4 max-h-64 overflow-auto border-t border-border"><table className="w-full whitespace-nowrap text-right text-xs"><thead className="sticky top-0 bg-surface"><tr>{["Periode / tanggal", "Rencana periode (%)", "Rencana kumulatif (%)", "Realisasi periode (%)", "Realisasi kumulatif (%)", "Deviasi (%)"].map((heading) => <th className="px-3 py-3 font-medium" key={heading}>{heading}</th>)}</tr></thead><tbody>{data.map((point, index) => { const previous = data[index - 1]; const actualPeriod = point.actual !== null && previous?.actual !== null && previous?.actual !== undefined ? point.actual - previous.actual : null; return <tr key={point.date} className="border-t border-border"><td className="px-3 py-2">{format(parseISO(point.date), "d/M/yyyy")}</td><td className="px-3 py-2">{number(point.plan - (previous?.plan ?? 0))}</td><td className="px-3 py-2">{number(point.plan)}</td><td className="px-3 py-2">{actualPeriod === null ? "—" : number(actualPeriod)}</td><td className="px-3 py-2">{point.actual === null ? "—" : number(point.actual)}</td><td className="px-3 py-2">{point.actual === null ? "—" : number(point.actual - point.plan)}</td></tr>; })}</tbody></table></div>
    </>}
    {onChange && <div className="mt-5 border-t border-border pt-4" aria-label="Pengisian progres manual">
      <h3 className="text-sm font-semibold">Pengisian progres manual</h3>
      <p className="mt-1 text-xs text-muted-foreground">Isi tanggal dan persentase realisasi; entri ini menjadi titik acuan garis Realisasi pada Kurva S. Tanggal yang sama menggantikan entri sebelumnya.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label className="text-xs">Tanggal pengisian</Label><div className="w-44"><ScheduleDatePicker label="Tanggal pengisian progres" value={entryDate} onChange={setEntryDate} /></div></div>
        <div className="space-y-1.5"><Label htmlFor="manual-progress" className="text-xs">Realisasi (%)</Label><Input id="manual-progress" inputMode="decimal" className="w-28" placeholder="0–100" value={entryActual} onChange={(event) => setEntryActual(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveEntry(); }} /></div>
        <div className="min-w-40 flex-1 space-y-1.5"><Label htmlFor="manual-progress-note" className="text-xs">Catatan (opsional)</Label><Input id="manual-progress-note" placeholder="Misal: progres minggu ke-4" value={entryNote} onChange={(event) => setEntryNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveEntry(); }} /></div>
        <Button type="button" onClick={saveEntry} disabled={!entryActual.trim()}><CalendarPlus />Simpan progres</Button>
      </div>
      {observations.length > 0 && <ul className="mt-4 divide-y divide-border rounded-md border border-border text-xs" aria-label="Riwayat pengisian progres">
        {[...observations].reverse().map((point) => <li key={point.date} className="flex items-center gap-3 px-3 py-2">
          <span className="w-24 shrink-0 font-medium">{format(parseISO(point.date), "d MMM yyyy", { locale: localeId })}</span>
          <span className="w-16 shrink-0 font-semibold text-primary">{number(point.actual)}%</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={point.note}>{point.note || "—"}</span>
          <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Hapus progres ${format(parseISO(point.date), "d MMM yyyy", { locale: localeId })}`} onClick={() => onChange(removeObservation(observations, point.date))}><Trash2 className="size-3.5" /></Button>
        </li>)}
      </ul>}
    </div>}
  </section>;
}
