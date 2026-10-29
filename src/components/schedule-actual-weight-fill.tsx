import { addDays, differenceInCalendarDays, parseISO } from "date-fns";

/** Split a weekly label at the same due-date boundary as the ordinary actual bar. */
export function ScheduleActualWeightFill({ start, days, due, width, height }: { start: string; days: number; due: string; width: number; height: number }) {
  const onTimeDays = Math.max(0, Math.min(days, differenceInCalendarDays(addDays(parseISO(due), 1), parseISO(start))));
  const blueWidth = width * onTimeDays / days;
  return <>
    {blueWidth > 0 && <rect width={blueWidth} height={height} fill="var(--schedule-today)" />}
    {blueWidth < width && <rect x={blueWidth} width={width - blueWidth} height={height} fill="var(--destructive)" />}
  </>;
}