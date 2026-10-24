import { format, parseISO } from "date-fns";
import { id } from "date-fns/locale";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ScheduleDatePicker({ label, value, onChange, min, compact = false, disabled = false, clearable = false }: { label: string; value: string; onChange: (value: string) => void; min?: string; compact?: boolean; disabled?: boolean; clearable?: boolean }) {
  const selected = value ? parseISO(value) : undefined;
  return <Popover><PopoverTrigger asChild><Button type="button" variant="outline" disabled={disabled} aria-label={label} className={`w-full justify-start font-normal ${compact ? "h-8 gap-1 px-1.5 text-[11px]" : ""}`} title={label}>{!compact && <CalendarDays className="size-4" />}{selected ? format(selected, compact ? "d/M/yy" : "d MMM yyyy", { locale: id }) : <span className="text-muted-foreground">—</span>}<ChevronDown className="ml-auto size-3 shrink-0" /></Button></PopoverTrigger><PopoverContent align="start" className="pointer-events-auto w-auto p-0"><Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={(date) => { if (date) onChange(format(date, "yyyy-MM-dd")); }} disabled={min ? { before: parseISO(min) } : undefined} locale={id} className="pointer-events-auto p-3" />{clearable && value && <Button type="button" variant="ghost" className="mb-2 w-full" onClick={() => onChange("")}>Kosongkan tanggal</Button>}</PopoverContent></Popover>;
}