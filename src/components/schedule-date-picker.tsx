import { format, parseISO } from "date-fns";
import { id } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ScheduleDatePicker({ label, value, onChange, min }: { label: string; value: string; onChange: (value: string) => void; min?: string }) {
  const selected = parseISO(value);
  return <Popover><PopoverTrigger asChild><Button type="button" variant="outline" aria-label={label} className="w-full justify-start font-normal"><CalendarDays className="size-4" />{format(selected, "d MMM yyyy", { locale: id })}</Button></PopoverTrigger><PopoverContent align="start" className="w-auto p-0"><Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={(date) => { if (date) onChange(format(date, "yyyy-MM-dd")); }} disabled={min ? { before: parseISO(min) } : undefined} locale={id} className="pointer-events-auto p-3" /></PopoverContent></Popover>;
}