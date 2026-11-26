import { Box, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Clading } from "@/lib/clading";

export function CladingTool({ items, height, offset, onHeight, onOffset, onChange }: {
  items: Clading[]; height: string; offset: string; onHeight: (v: string) => void; onOffset: (v: string) => void; onChange: (items: Clading[]) => void;
}) {
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2">
      <Label className="space-y-1 text-xs">Tinggi (m)<Input aria-label="Tinggi clading" type="number" min="0.12" step="0.1" value={height} onChange={(e) => onHeight(e.target.value)} /></Label>
      <Label className="space-y-1 text-xs">Dasar dari level (m)<Input aria-label="Dasar clading" type="number" step="0.1" value={offset} onChange={(e) => onOffset(e.target.value)} /></Label>
    </div>
    <div className="text-xs font-medium text-muted-foreground">Item 3D · Clading ({items.length})</div>
    {items.map((item) => <div key={item.id} className="flex items-center gap-2">
      <Box className="h-4 w-4 shrink-0 text-primary" />
      <Input className="h-8 min-w-0 text-xs" aria-label={`Nama ${item.name}`} value={item.name} onChange={(e) => onChange(items.map((c) => c.id === item.id ? { ...c, name: e.target.value } : c))} />
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title={`Hapus ${item.name}`} aria-label={`Hapus ${item.name}`} onClick={() => onChange(items.filter((c) => c.id !== item.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>)}
  </div>;
}