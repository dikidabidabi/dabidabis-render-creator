import { useState } from "react";
import { Box, Trash2, Pencil, Move, Plus, Minus, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { boxOutline, editCladingPoint, type Clading } from "@/lib/clading";

export type CladingPointSelection={id:string;boxIndex:number;index:number};
export type CladingPlanMode="draw"|"move"|"add"|"delete";
export function CladingTool({ items, height, offset, onHeight, onOffset, onChange, mode, onMode, selection, onSelection, ppm }: {
  items: Clading[]; height: string; offset: string; onHeight: (v: string) => void; onOffset: (v: string) => void; onChange: (items: Clading[]) => void;
  mode:CladingPlanMode;onMode:(mode:CladingPlanMode)=>void;selection:CladingPointSelection|null;onSelection:(s:CladingPointSelection|null)=>void;ppm:number;
}) {
  const [dx,setDx]=useState("0"),[dy,setDy]=useState("0");
  const item=items.find(c=>c.id===selection?.id),box=selection&&item?.boxes[selection.boxIndex],point=box&&selection?boxOutline(box)[selection.index]:undefined;
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2">
      <Label className="space-y-1 text-xs">Tinggi (m)<Input aria-label="Tinggi clading" type="number" min="0.12" step="0.1" value={height} onChange={(e) => onHeight(e.target.value)} /></Label>
      <Label className="space-y-1 text-xs">Dasar dari level (m)<Input aria-label="Dasar clading" type="number" step="0.1" value={offset} onChange={(e) => onOffset(e.target.value)} /></Label>
    </div>
    <div className="flex flex-wrap gap-1" role="group" aria-label="Edit titik clading">
      <Button size="icon" variant={mode==="draw"?"secondary":"ghost"} aria-label="Gambar clading" title="Gambar clading" onClick={()=>onMode("draw")}><Box className="h-4 w-4" /></Button>
      <Button size="icon" variant={mode==="move"?"secondary":"ghost"} aria-label="Edit titik clading" title="Edit titik clading" onClick={()=>onMode("move")}><MousePointer2 className="h-4 w-4" /></Button>
      <Button size="icon" variant={mode==="add"?"secondary":"ghost"} aria-label="Tambah titik clading" title="Tambah titik clading" onClick={()=>onMode("add")}><Plus className="h-4 w-4" /></Button>
      <Button size="icon" variant={mode==="delete"?"secondary":"ghost"} aria-label="Hapus titik clading" title="Hapus titik clading" onClick={()=>onMode("delete")}><Minus className="h-4 w-4" /></Button>
    </div>
    {mode!=="draw"&&<>
      <div className="text-xs text-muted-foreground">{point&&selection?`Titik ${selection.index+1} · X ${Math.round(point.x/ppm*1000)} · Y ${Math.round(point.y/ppm*1000)} mm`:"Belum ada titik terpilih"}</div>
      <div className="grid grid-cols-2 gap-2">
        <Label className="text-xs">ΔX (mm)<Input aria-label="Geser titik clading X" type="number" value={dx} onChange={e=>setDx(e.target.value)} /></Label>
        <Label className="text-xs">ΔY (mm)<Input aria-label="Geser titik clading Y" type="number" value={dy} onChange={e=>setDy(e.target.value)} /></Label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!point} onClick={()=>{
          if(!selection||!item||!point)return;
          const next=editCladingPoint(item,selection.boxIndex,selection.index,{x:point.x+Number(dx)/1000*ppm,y:point.y+Number(dy)/1000*ppm});
          if(next===item)return;
          onChange(items.map(c=>c.id===item.id?next:c));setDx("0");setDy("0");
        }}><Move className="mr-1 h-3.5 w-3.5" />Geser titik</Button>
        <Button size="icon" variant="outline" disabled={!box||boxOutline(box).length<=3} aria-label="Hapus titik terpilih" title="Hapus titik terpilih" onClick={()=>{
          if(!item||!selection)return;const next=editCladingPoint(item,selection.boxIndex,selection.index,null);if(next===item)return;onChange(items.map(c=>c.id===item.id?next:c));onSelection(null);
        }}><Trash2 className="h-4 w-4" /></Button>
      </div>
    </>}
    <div className="text-xs font-medium text-muted-foreground">Item 3D · Clading ({items.length})</div>
    {items.map((item) => <div key={item.id} className="flex items-center gap-2">
      <Box className="h-4 w-4 shrink-0 text-primary" />
      <Input className="h-8 min-w-0 text-xs" aria-label={`Nama ${item.name}`} value={item.name} onChange={(e) => onChange(items.map((c) => c.id === item.id ? { ...c, name: e.target.value } : c))} />
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title={`Edit titik ${item.name}`} aria-label={`Edit titik ${item.name}`} onClick={()=>{onMode("move");onSelection({id:item.id,boxIndex:0,index:0});}}><Pencil className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title={`Hapus ${item.name}`} aria-label={`Hapus ${item.name}`} onClick={() => onChange(items.filter((c) => c.id !== item.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>)}
  </div>;
}
