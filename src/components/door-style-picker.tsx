import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DOOR_STYLES, doorStyle, type DoorStyle } from "@/lib/doors";

export function DoorStylePicker({ value, onChange, label = "Tipe pintu" }: { value?: DoorStyle; onChange: (value: DoorStyle) => void; label?: string }) {
  return <Select value={doorStyle(value)} onValueChange={next => onChange(doorStyle(next))}>
    <SelectTrigger aria-label={label} className="h-auto min-h-8 text-xs [&_span]:whitespace-normal [&_span]:text-left"><SelectValue /></SelectTrigger>
    <SelectContent>{DOOR_STYLES.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}