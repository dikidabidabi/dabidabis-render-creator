import { PREDECESSOR_LABELS, type ScheduleTask } from "@/lib/schedule";
import { scheduleConnectors, SCHEDULE_ROW_HEIGHT } from "@/lib/schedule-connectors";

export function ScheduleDependencyLinks({ tasks, start, dayWidth, width, left, critical }: { tasks: ScheduleTask[]; start: Date; dayWidth: number; width: number; left: number; critical?: Set<string> }) {
  const links = scheduleConnectors(tasks, start, dayWidth);
  if (!links.length) return null;
  return <svg className="schedule-dependency-layer pointer-events-none absolute z-[5]" style={{ left, top: 70 }} width={width} height={tasks.length * SCHEDULE_ROW_HEIGHT} role="img" aria-label="Hubungan predecessor antar pekerjaan">
    {links.map((link) => <g key={link.id} className={`schedule-link schedule-link-${link.type} ${critical?.has(link.targetId) && critical.has(link.sourceId) ? "schedule-critical-link" : ""}`} data-dependency-type={link.type}>
      <title>{link.label} · {PREDECESSOR_LABELS[link.type]}</title>
      <path d={link.path} className="schedule-link-line" />
      <circle cx={link.source.x} cy={link.source.y} r={2.5} className="schedule-link-origin" />
      <path d={link.arrow} className="schedule-link-line" />
    </g>)}
  </svg>;
}