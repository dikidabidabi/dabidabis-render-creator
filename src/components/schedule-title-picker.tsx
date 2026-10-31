import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ScheduleTemplate } from "@/lib/schedule-library";

export function ScheduleTitlePicker({ value, templates, onManual, onTemplate, summary = false, label = "Judul pekerjaan" }: { value: string; templates: ScheduleTemplate[]; onManual: (value: string) => void; onTemplate: (template: ScheduleTemplate) => void; summary?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  return <div className={`flex w-full min-w-0 items-center ${summary ? "schedule-title-box" : ""}`}>
    <Input key={value} aria-label={label} defaultValue={value} className={`h-9 min-w-0 border-transparent bg-transparent px-1 text-xs shadow-none ${summary ? "font-bold text-inherit" : ""}`} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={(event) => onManual(event.currentTarget.value)} />
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-7 shrink-0 text-inherit" aria-label={`Template ${value || "pekerjaan"}`} title="Pilih template"><ChevronDown className="size-3" /></Button></PopoverTrigger><PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2"><Input aria-label="Cari template" placeholder="Cari judul pekerjaan…" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="mt-2 max-h-64 overflow-auto" role="listbox" aria-label="Template pekerjaan">{templates.map((template) => {
      const root = template.works.find((work) => !work.wbs.includes("."));
      if (!root || !template.works.some((work) => work.title.toLowerCase().includes(search.toLowerCase()))) return null;
      return <Button key={template.id} type="button" variant="ghost" className="h-auto w-full flex-col items-start gap-1 whitespace-normal py-2 text-left" role="option" aria-selected={false} onClick={() => { onTemplate(template); setOpen(false); }}><span className="text-sm font-medium">{root.title}</span><span className="text-xs font-normal text-muted-foreground">{template.works.length} pekerjaan · {root.duration} hari</span></Button>;
    })}{!templates.length && <p className="p-2 text-xs text-muted-foreground">Pustaka jadwal kosong.</p>}</div></PopoverContent></Popover>
  </div>;
}