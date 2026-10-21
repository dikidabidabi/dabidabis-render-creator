import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DynamicWindowSettings({ spacing, tolerance, onChange, onEditStart }: {
  spacing: number;
  tolerance: number;
  onChange: (values: { dividerSpacingCm?: number; endToleranceCm?: number }) => void;
  onEditStart?: () => void;
}) {
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor="window-divider-spacing" className="text-[11px] text-muted-foreground">Jarak pembatas (cm)</Label>
      <Input id="window-divider-spacing" type="number" min={5} step={5} value={spacing} onFocus={onEditStart} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) onChange({ dividerSpacingCm: Math.max(5, value) }); }} className="h-7 w-20 text-xs" />
    </div>
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor="window-end-tolerance" className="text-[11px] text-muted-foreground">Toleransi ujung (cm)</Label>
      <Input id="window-end-tolerance" type="number" min={0} step={5} value={tolerance} onFocus={onEditStart} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) onChange({ endToleranceCm: Math.max(0, value) }); }} className="h-7 w-20 text-xs" />
    </div>
  </div>;
}