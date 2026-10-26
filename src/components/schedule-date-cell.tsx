import type { PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { ScheduleDatePicker } from "./schedule-date-picker";
import { SCHEDULE_DATE_LABELS, type ScheduleDateField } from "@/lib/schedule-dates";
import { taskPredecessors, type ScheduleTask } from "@/lib/schedule";

export function ScheduleDateCell({ task, field, selected, onChange, onFillStart }: { task: ScheduleTask; field: ScheduleDateField; selected: boolean; onChange: (value: string) => void; onFillStart: (event: PointerEvent<HTMLButtonElement>) => void }) {
  const value = task[field] ?? "";
  const locked = (field === "start" || field === "due") && taskPredecessors(task).length > 0;
  const label = `${SCHEDULE_DATE_LABELS[field]} ${task.title}`;
  return <div data-date-field={field} className={`relative mx-1 ${selected ? "ring-2 ring-primary bg-primary/10" : ""}`}>
    <ScheduleDatePicker compact label={label} value={value} onChange={onChange} disabled={locked} min={field === "due" ? task.start : field === "actualFinish" ? task.actualStart : undefined} clearable={field === "actualStart" || field === "actualFinish"} />
    {value && !locked && <Button type="button" size="icon" variant="default" className="absolute -bottom-1 -right-1 z-10 size-3 rounded-none border border-background p-0 touch-none cursor-crosshair" aria-label={`Salin ke bawah ${label}`} title={`Salin ke bawah ${label}`} onPointerDown={onFillStart} onClick={(event) => event.stopPropagation()} />}
  </div>;
}