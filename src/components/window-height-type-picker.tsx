import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { WINDOW_HEIGHT_TYPES, type WindowHeightType } from "@/lib/windows";

/** Pilihan tipe tinggi jendela: Full Window, Jendela Standar, Window Wall. */
export function WindowHeightTypePicker({ value, onChange }: { value: WindowHeightType; onChange: (value: WindowHeightType) => void }) {
  const active = WINDOW_HEIGHT_TYPES.find((item) => item.value === value);
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-muted-foreground">Tipe jendela</Label>
      <div className="grid grid-cols-3 gap-1">
        {WINDOW_HEIGHT_TYPES.map((item) => (
          <Button
            key={item.value}
            type="button"
            size="sm"
            variant={value === item.value ? "default" : "outline"}
            onClick={() => onChange(item.value)}
            title={item.hint}
            aria-pressed={value === item.value}
            className="h-auto min-h-8 whitespace-normal px-1 py-1 text-[10px] leading-tight"
          >
            {item.label}
          </Button>
        ))}
      </div>
      {active && <p className="text-[10px] leading-snug text-muted-foreground">{active.hint}.</p>}
    </div>
  );
}
