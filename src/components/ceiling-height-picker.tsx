import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeCeilingHeight, parseCeilingHeight, type CeilingHeight } from "@/lib/room-ceiling";

export function CeilingHeightPicker({ value, onChange, label = "Tinggi plafon", onFillStart }: {
  value?: CeilingHeight; onChange: (value: CeilingHeight) => void; label?: string;
  onFillStart?: (event: React.PointerEvent<HTMLSpanElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const chosen = normalizeCeilingHeight(value);
  const select = (height: CeilingHeight) => { onChange(height); setOpen(false); };
  return <div className="group/ceiling relative min-w-0">
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setDraft(chosen === null ? "2,8" : String(chosen).replace(".", ",")); }}>
      <PopoverTrigger asChild><Button variant="outline" role="combobox" aria-expanded={open} aria-label={label} className="h-8 w-full justify-between gap-2 px-2 text-xs font-normal">
        <span>{chosen === null ? "Tanpa plafon" : `${String(chosen).replace(".", ",")} m`}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </Button></PopoverTrigger>
      <PopoverContent className="w-56 space-y-1 p-2" align="start">
        {[2.4, 2.6, 2.8, 3, 3.2, 3.5, null].map(height => <Button key={height ?? "none"} variant="ghost" className="h-8 w-full justify-between px-2 text-xs font-normal" onClick={() => select(height)}>
          {height === null ? "Tanpa plafon" : `${String(height).replace(".", ",")} m`}<Check className={chosen === height ? "h-3 w-3" : "h-3 w-3 opacity-0"} />
        </Button>)}
        <form className="flex items-center gap-1 border-t border-border pt-2" onSubmit={event => { event.preventDefault(); const height = parseCeilingHeight(draft); if (height !== undefined) select(height); }}>
          <Input aria-label={`${label} manual (m)`} inputMode="decimal" value={draft} onChange={event => setDraft(event.target.value)} className="h-8 min-w-0 text-xs" />
          <span className="text-xs text-muted-foreground">m</span><Button type="submit" size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label="Terapkan tinggi plafon" disabled={parseCeilingHeight(draft) === undefined}><Check className="h-3.5 w-3.5" /></Button>
        </form>
      </PopoverContent>
    </Popover>
    {onFillStart && <span role="button" aria-label={`Salin ${label} ke baris lain`} title="Tarik untuk menyalin ke baris lain" className="absolute -bottom-0.5 -right-0.5 z-10 h-2.5 w-2.5 cursor-ns-resize touch-none border border-background bg-primary opacity-70 group-hover/ceiling:opacity-100" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); onFillStart(event); }} />}
  </div>;
}