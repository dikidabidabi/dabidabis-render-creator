import { useMemo, useRef, useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printScheduleSection } from "@/lib/schedule-print";
import { addDays, differenceInCalendarDays, endOfWeek, format, parseISO, startOfWeek } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { actualBarRanges, actualProgressAt, plannedProgress, scheduleLeaves, weightedProgress } from "@/lib/schedule-analysis";
import { scheduleDuration, type ScheduleTask } from "@/lib/schedule";
import { Checkbox } from "@/components/ui/checkbox";

export function ScheduleSCurve({ tasks, today }: { tasks: ScheduleTask[]; today: Date }) {
  const current = format(today, "yyyy-MM-dd");
  const data = useMemo(() => {
    const leaves = scheduleLeaves(tasks);
    const start = leaves.map((task) => task.start).sort()[0];
    const end = leaves.map((task) => task.due).sort().at(-1);
    if (!start || !end) return [];
    const days = differenceInCalendarDays(parseISO(end), parseISO(start));
    const step = Math.max(7, Math.ceil(days / 260));
    const dates = new Set([start, end, current, ...leaves.flatMap((task) => [task.start, task.due, ...(task.actualStart ? [task.actualStart] : []), ...(task.actualFinish ? [task.actualFinish] : [])]), ...leaves.flatMap((task) => (task.progressEntries ?? []).map((point) => point.date))]);
    for (let d = step; d < days; d += step) dates.add(format(addDays(parseISO(start), d), "yyyy-MM-dd"));
    return [...dates].sort().map((date) => {
      const actual = date > current ? null : actualProgressAt(tasks, date);
      return { date, time: parseISO(date).getTime(), plan: plannedProgress(tasks, date), actual };
    });
  }, [tasks, current]);
  const plan = plannedProgress(tasks, current), actual = actualProgressAt(tasks, current) ?? weightedProgress(tasks, current), deviation = actual - plan;
  const number = (value: number) => value.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  const leaves = scheduleLeaves(tasks);
  const sectionRef = useRef<HTMLElement>(null);
  return <section ref={sectionRef} className="schedule-s-curve mt-7 rounded-lg border border-border bg-background p-4" aria-label="Kurva S">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-display text-xl font-semibold">Kurva S</h2><p className="mt-1 text-xs text-muted-foreground">Bobot durasi · {leaves.reduce((sum, task) => sum + Math.max(1, scheduleDuration(task.start, task.due)), 0)} hari-pekerjaan</p></div><div className="flex flex-wrap items-start gap-4"><dl className="flex flex-wrap gap-6 text-sm">{[["Rencana", number(plan) + "%"], ["Realisasi", number(actual) + "%"], ["Deviasi", (deviation > 0 ? "+" : "") + number(deviation) + "%"], ["SPI", plan ? number(actual / plan) : "—"]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 font-semibold ${label === "Deviasi" && deviation < 0 ? "text-destructive" : "text-foreground"}`}>{value}</dd></div>)}</dl><Button variant="outline" size="sm" className="print:hidden" onClick={() => printScheduleSection(sectionRef.current, "scurve")} disabled={!data.length} title="Unduh Kurva S sebagai PDF lanskap"><FileDown />Unduh PDF</Button></div></div>
    {!data.length ? <p className="py-12 text-center text-sm text-muted-foreground">Belum ada data jadwal.</p> : <>
      <SCurveChart tasks={tasks} data={data} current={current} number={number} />
      <div className="mt-4 max-h-64 overflow-auto border-t border-border"><table className="w-full whitespace-nowrap text-right text-xs"><thead className="sticky top-0 bg-surface"><tr>{["Periode / tanggal", "Rencana periode (%)", "Rencana kumulatif (%)", "Realisasi periode (%)", "Realisasi kumulatif (%)", "Deviasi (%)"].map((heading) => <th className="px-3 py-3 font-medium" key={heading}>{heading}</th>)}</tr></thead><tbody>{data.map((point, index) => { const previous = data[index - 1]; const actualPeriod = point.actual !== null && previous?.actual !== null && previous?.actual !== undefined ? point.actual - previous.actual : null; return <tr key={point.date} className="border-t border-border"><td className="px-3 py-2">{format(parseISO(point.date), "d/M/yyyy")}</td><td className="px-3 py-2">{number(point.plan - (previous?.plan ?? 0))}</td><td className="px-3 py-2">{number(point.plan)}</td><td className="px-3 py-2">{actualPeriod === null ? "—" : number(actualPeriod)}</td><td className="px-3 py-2">{point.actual === null ? "—" : number(point.actual)}</td><td className="px-3 py-2">{point.actual === null ? "—" : number(point.actual - point.plan)}</td></tr>; })}</tbody></table></div>
    </>}
  </section>;
}

type CurvePoint = { date: string; plan: number; actual: number | null };
const AXIS_ROW = 22, NAME_WIDTH = 220;

/** Gantt superimposition: plan bar start→due; realization bar start→first 100% entry or latest dated entry. */
function realizationEnd(task: ScheduleTask) {
  const entries = [...(task.progressEntries ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  return task.actualFinish ?? entries.find((point) => point.actual >= 100)?.date ?? entries.at(-1)?.date ?? null;
}

function SCurveChart({ tasks, data, current, number }: { tasks: ScheduleTask[]; data: CurvePoint[]; current: string; number: (value: number) => string }) {
  const [gantt, setGantt] = useState(false);
  const firstPoint = data[0], lastPoint = data.at(-1);
  if (!firstPoint || !lastPoint) return null;
  const first = parseISO(firstPoint.date), last = parseISO(lastPoint.date);
  const start = startOfWeek(first, { weekStartsOn: 1 }), end = addDays(endOfWeek(last, { weekStartsOn: 1 }), 1);
  const days = Math.max(7, differenceInCalendarDays(end, start));
  const dayW = Math.max(4, 900 / days), width = days * dayW;
  const rows = gantt ? tasks : [];
  const height = Math.max(320, rows.length * 34);
  const rowH = rows.length ? height / rows.length : 0;
  const x = (date: string | Date) => differenceInCalendarDays(typeof date === "string" ? parseISO(date) : date, start) * dayW;
  const y = (value: number) => height - (value / 100) * height;
  const weeks = Array.from({ length: Math.ceil(days / 7) }, (_, index) => addDays(start, index * 7));
  const spans = (key: string, label: (date: Date) => string) => {
    const out: { key: string; label: string; from: number; to: number }[] = [];
    for (let d = 0; d < days; d++) {
      const date = addDays(start, d), k = format(date, key);
      const previous = out.at(-1);
      if (previous?.key === k) previous.to = (d + 1) * dayW; else out.push({ key: k, label: label(date), from: d * dayW, to: (d + 1) * dayW });
    }
    return out;
  };
  const months = spans("yyyy-MM", (date) => format(date, "MMM", { locale: localeId })), years = spans("yyyy", (date) => format(date, "yyyy"));
  const line = (points: { date: string; value: number }[]) => points.map((point) => `${x(point.date).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const plan = data.map((point) => ({ date: point.date, value: point.plan }));
  const actual = data.flatMap((point) => point.actual === null ? [] : [{ date: point.date, value: point.actual }]);
  const axisLabels = ["Minggu", "Bulan", "Tahun"];
  return <div className="mt-5">
    <label className="mb-3 flex w-fit items-center gap-2 text-sm print:hidden"><Checkbox checked={gantt} onCheckedChange={(value) => setGantt(value === true)} />Munculkan gantt chart</label>
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="h-0.5 w-5 bg-[var(--schedule-link-fs)]" />Rencana</span><span className="flex items-center gap-2"><span className="h-0.5 w-5 bg-[var(--schedule-link-ss)]" />Realisasi</span>{gantt && <><span className="flex items-center gap-2"><span className="h-2 w-5 bg-muted-foreground opacity-50" />Bar rencana</span><span className="flex items-center gap-2"><span className="h-1 w-5 bg-[var(--schedule-link-ss)] opacity-50" />Bar realisasi</span></>}<span className="flex items-center gap-2"><span className="h-3 w-0.5 bg-[var(--schedule-today)]" />Hari ini</span></div>
    <div className="mt-3 flex overflow-x-auto">
      <div className="sticky left-0 z-10 shrink-0 bg-background text-xs" style={{ width: gantt ? NAME_WIDTH : 64 }}>
        <div style={{ height }}>{rows.map((task) => <div key={task.id} className="flex items-center truncate border-b border-border bg-surface px-2" style={{ height: rowH }} title={task.title}><span className="truncate">{task.wbs} {task.title}</span></div>)}</div>
        {axisLabels.map((label) => <div key={label} className="flex items-center justify-end pr-2 text-muted-foreground" style={{ height: AXIS_ROW }}>{label}</div>)}
      </div>
      <svg width={width + 44} height={height + AXIS_ROW * 3} className="shrink-0 text-xs" role="img" aria-label="Grafik Kurva S">
        {[0, 20, 40, 60, 80, 100].map((value) => <g key={value}><line x1={0} x2={width} y1={y(value)} y2={y(value)} stroke="var(--border)" /><text x={width + 4} y={y(value) + 4} fill="var(--muted-foreground)" fontSize={11}>{value}%</text></g>)}
        {weeks.map((week) => <line key={week.toISOString()} x1={x(week)} x2={x(week)} y1={0} y2={height} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="3 4" />)}
        {rows.map((task, index) => { const top = index * rowH, realized = realizationEnd(task), ranges = actualBarRanges(task, current); return <g key={task.id} opacity={0.5}><line x1={0} x2={width} y1={top + rowH} y2={top + rowH} stroke="var(--border)" /><rect x={x(task.start)} y={top + rowH * 0.22} width={Math.max(2, x(addDays(parseISO(task.due), 1)) - x(task.start))} height={rowH * 0.32} fill="var(--muted-foreground)" /><title>{`${task.title}: ${task.start} – ${task.due}`}</title>{ranges.map((range) => <rect key={`${range.start}-${range.late}`} x={x(range.start)} y={top + rowH * 0.62} width={Math.max(2, x(addDays(parseISO(range.end), 1)) - x(range.start))} height={Math.max(3, rowH * 0.12)} rx={3} fill={range.late ? "var(--destructive)" : "var(--schedule-today)"} />)}{!ranges.length && realized && <rect x={x(task.start)} y={top + rowH * 0.62} width={Math.max(2, x(addDays(parseISO(realized), 1)) - x(task.start))} height={Math.max(3, rowH * 0.12)} fill="var(--schedule-link-ss)" />}</g>; })}
        <line x1={x(current)} x2={x(current)} y1={0} y2={height} stroke="var(--schedule-today)" strokeDasharray="4 4" />
        <polyline points={line(plan)} fill="none" stroke="var(--schedule-link-fs)" strokeWidth={2.5} />
        {actual.length > 0 && <polyline points={line(actual)} fill="none" stroke="var(--schedule-link-ss)" strokeWidth={2.5} />}
        {actual.map((point) => <circle key={point.date} cx={x(point.date)} cy={y(point.value)} r={3} fill="var(--schedule-link-ss)"><title>{`${point.date}: ${number(point.value)}%`}</title></circle>)}
        <rect x={0} y={0} width={width} height={height} fill="none" stroke="var(--border)" />
        {weeks.map((week, index) => <g key={week.toISOString()}><rect x={x(week)} y={height} width={7 * dayW} height={AXIS_ROW} fill="none" stroke="var(--border)" /><text x={x(week) + 3} y={height + 15} fill="var(--foreground)" fontSize={11}>{index + 1}</text></g>)}
        {[months, years].map((segments, row) => segments.map((segment) => <g key={segment.key}><rect x={segment.from} y={height + AXIS_ROW * (row + 1)} width={segment.to - segment.from} height={AXIS_ROW} fill="none" stroke="var(--border)" /><text x={segment.from + 4} y={height + AXIS_ROW * (row + 1) + 15} fill="var(--foreground)" fontSize={11}>{segment.to - segment.from > 24 ? segment.label : ""}</text></g>))}
      </svg>
    </div>
  </div>;
}
