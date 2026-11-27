import { useState } from "react";
import {
  Box,
  Trash2,
  Pencil,
  Move,
  Plus,
  Minus,
  MousePointer2,
  Copy,
  Link2,
  ClipboardPaste,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { boxOutline, editCladingPoint, moveClading, type Clading } from "@/lib/clading";
import { moveCladingPoints } from "@/lib/clading-ops";

export type CladingPointSelection = { id: string; boxIndex: number; index: number };
export type CladingPlanMode = "draw" | "move" | "add" | "delete";
export function CladingTool({
  items,
  height,
  offset,
  onHeight,
  onOffset,
  onChange,
  mode,
  onMode,
  selection,
  onSelection,
  activeId,
  onActive,
  onCopy,
  onPaste,
  pasteLabel,
  ppm,
}: {
  items: Clading[];
  height: string;
  offset: string;
  onHeight: (v: string) => void;
  onOffset: (v: string) => void;
  onChange: (items: Clading[]) => void;
  mode: CladingPlanMode;
  onMode: (mode: CladingPlanMode) => void;
  selection: CladingPointSelection[];
  onSelection: (s: CladingPointSelection[]) => void;
  activeId: string | null;
  onActive: (id: string | null) => void;
  onCopy: (item: Clading, linked: boolean) => void;
  onPaste: (() => void) | null;
  pasteLabel: string;
  ppm: number;
}) {
  const [dx, setDx] = useState("0"),
    [dy, setDy] = useState("0"),
    [mx, setMx] = useState("0"),
    [my, setMy] = useState("0"),
    [mz, setMz] = useState("0");
  const primary = selection[0];
  const item = items.find((c) => c.id === primary?.id),
    box = primary && item?.boxes[primary.boxIndex],
    point = box && primary ? boxOutline(box)[primary.index] : undefined;
  const active = items.find((c) => c.id === activeId);
  const modeButton = (m: CladingPlanMode, label: string, Icon: typeof Box) => (
    <Button
      size="icon"
      variant={mode === m ? "secondary" : "ghost"}
      aria-label={label}
      title={label}
      onClick={() => onMode(m)}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Label className="space-y-1 text-xs">
          Tinggi (m)
          <Input
            aria-label="Tinggi clading"
            type="number"
            min="0.12"
            step="0.1"
            value={height}
            onChange={(e) => onHeight(e.target.value)}
          />
        </Label>
        <Label className="space-y-1 text-xs">
          Dasar dari level (m)
          <Input
            aria-label="Dasar clading"
            type="number"
            step="0.1"
            value={offset}
            onChange={(e) => onOffset(e.target.value)}
          />
        </Label>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Edit titik clading">
        {modeButton("draw", "Gambar clading", Box)}
        {modeButton("move", "Edit titik clading", MousePointer2)}
        {modeButton("add", "Tambah titik clading", Plus)}
        {modeButton("delete", "Hapus titik clading", Minus)}
      </div>
      {mode !== "draw" && (
        <>
          <div className="text-xs text-muted-foreground">
            {selection.length > 1
              ? `${selection.length} titik terpilih`
              : point && primary
                ? `Titik ${primary.index + 1} · X ${Math.round((point.x / ppm) * 1000)} · Y ${Math.round((point.y / ppm) * 1000)} mm`
                : "Belum ada titik terpilih · tarik marquee untuk memilih banyak titik"}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Label className="text-xs">
              ΔX (mm)
              <Input
                aria-label="Geser titik clading X"
                type="number"
                value={dx}
                onChange={(e) => setDx(e.target.value)}
              />
            </Label>
            <Label className="text-xs">
              ΔY (mm)
              <Input
                aria-label="Geser titik clading Y"
                type="number"
                value={dy}
                onChange={(e) => setDy(e.target.value)}
              />
            </Label>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!selection.length}
              onClick={() => {
                const next = moveCladingPoints(
                  items,
                  selection,
                  (Number(dx) / 1000) * ppm,
                  (Number(dy) / 1000) * ppm,
                );
                onChange(next);
                setDx("0");
                setDy("0");
              }}
            >
              <Move className="mr-1 h-3.5 w-3.5" />
              Geser titik
            </Button>
            <Button
              size="icon"
              variant="outline"
              disabled={selection.length !== 1 || !box || boxOutline(box).length <= 3}
              aria-label="Hapus titik terpilih"
              title="Hapus titik terpilih"
              onClick={() => {
                if (!item || !primary) return;
                const next = editCladingPoint(item, primary.boxIndex, primary.index, null);
                if (next === item) return;
                onChange(items.map((c) => (c.id === item.id ? next : c)));
                onSelection([]);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}
      <div className="space-y-2 rounded-md border border-border p-2">
        <div className="text-xs font-medium">
          {active ? `Clading terpilih: ${active.name}` : "Pilih clading dari daftar"}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["X", mx, setMx],
              ["Y", my, setMy],
              ["Z", mz, setMz],
            ] as const
          ).map(([axis, value, set]) => (
            <Label key={axis} className="text-xs">
              Δ{axis} (mm)
              <Input
                aria-label={`Geser clading ${axis}`}
                type="number"
                value={value}
                onChange={(e) => set(e.target.value)}
              />
            </Label>
          ))}
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={!active}
          onClick={() => {
            if (!active) return;
            const next = moveClading(
              active,
              (Number(mx) / 1000) * ppm,
              (Number(my) / 1000) * ppm,
              Number(mz) / 1000,
            );
            onChange(items.map((c) => (c.id === active.id ? next : c)));
            setMx("0");
            setMy("0");
            setMz("0");
          }}
        >
          <Move className="mr-1 h-3.5 w-3.5" />
          Geser clading
        </Button>
        <div className="grid grid-cols-3 gap-1">
          <Button size="sm" variant="outline" disabled={!active} onClick={() => active && onCopy(active, false)}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            Copy
          </Button>
          <Button size="sm" variant="outline" disabled={!active} onClick={() => active && onCopy(active, true)}>
            <Link2 className="mr-1 h-3.5 w-3.5" />
            Instance
          </Button>
          <Button size="sm" variant="outline" disabled={!onPaste} onClick={() => onPaste?.()} title={pasteLabel}>
            <ClipboardPaste className="mr-1 h-3.5 w-3.5" />
            Paste
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground">{pasteLabel}</div>
      </div>
      <div className="text-xs font-medium text-muted-foreground">
        Item 3D · Clading ({items.length})
      </div>
      {items.map((c) => (
        <div key={c.id} className="flex items-center gap-1">
          <Button
            variant={c.id === activeId ? "secondary" : "ghost"}
            size="icon"
            className={cn("h-8 w-8 shrink-0", c.id === activeId && "text-primary")}
            aria-label={`Pilih ${c.name}`}
            title={`Pilih ${c.name}`}
            onClick={() => onActive(c.id === activeId ? null : c.id)}
          >
            {c.linkId ? <Link2 className="h-4 w-4" /> : <Box className="h-4 w-4" />}
          </Button>
          <Input
            className="h-8 min-w-0 text-xs"
            aria-label={`Nama ${c.name}`}
            value={c.name}
            onChange={(e) =>
              onChange(items.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))
            }
          />
          {c.linkId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              title={`Lepas instance ${c.name}`}
              aria-label={`Lepas instance ${c.name}`}
              onClick={() =>
                onChange(
                  items.map((x) => {
                    if (x.id !== c.id) return x;
                    const { linkId: _drop, ...rest } = x;
                    return rest;
                  }),
                )
              }
            >
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title={`Edit titik ${c.name}`}
            aria-label={`Edit titik ${c.name}`}
            onClick={() => {
              onMode("move");
              onActive(c.id);
              onSelection([{ id: c.id, boxIndex: 0, index: 0 }]);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title={`Hapus ${c.name}`}
            aria-label={`Hapus ${c.name}`}
            onClick={() => onChange(items.filter((x) => x.id !== c.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
