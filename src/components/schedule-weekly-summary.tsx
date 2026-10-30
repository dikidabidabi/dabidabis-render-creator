import { formatScheduleWeight, WEEKLY_SUMMARY_ROWS, type weeklyScheduleSummary } from "@/lib/schedule-weights";

export type WeeklySummary = ReturnType<typeof weeklyScheduleSummary>;
export const SUMMARY_ROW_HEIGHT = 28;

export function ScheduleWeeklySummary({ summary, labelWidth, width, dayWidth, offset }: { summary: WeeklySummary; labelWidth: number; width: number; dayWidth: number; offset: (start: string) => number }) {
  return <div className="relative z-10 bg-background" aria-label="Ringkasan bobot mingguan">
    {WEEKLY_SUMMARY_ROWS.map((row) => <div key={row.key} className="flex border-b border-border text-[10px] tabular-nums" style={{ height: SUMMARY_ROW_HEIGHT }}>
      <div className="sticky left-0 z-10 flex shrink-0 items-center justify-end bg-surface px-2 font-semibold" style={{ width: labelWidth }}>{row.label}</div>
      <div className="relative shrink-0 overflow-hidden" style={{ width }}>{summary.map((week) => {
        const left = Math.max(0, offset(week.start)), right = Math.min(width, offset(week.start) + 7 * dayWidth);
        const value = week[row.key];
        return right <= left ? null : <div key={week.start} className="absolute inset-y-0 flex items-center justify-center border-l border-border px-0.5" style={{ left, width: right - left }} title={`${row.label} · ${week.start} · ${value === null ? "—" : formatScheduleWeight(value)}`} aria-label={`${row.label} ${week.start}`}>{value === null ? "—" : formatScheduleWeight(value)}</div>;
      })}</div>
    </div>)}
  </div>;
}