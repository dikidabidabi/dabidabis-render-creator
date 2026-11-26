import { useMemo, useRef } from "react";
import { TransformControls } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Box, Move3d, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cladingFaces, extrudeClading, type Clading, type CladingFace } from "@/lib/clading";

export type CladingEditState = { id: string; face: CladingFace | null; mode: "move" | "extrude"; plane: "horizontal" | "vertical"; segment: boolean; distance: string };
export const initialCladingEdit: CladingEditState = { id: "", face: null, mode: "move", plane: "horizontal", segment: true, distance: "0.5" };
export function CladingEditPanel({ items, state, setState, onChange, ppm }: { items: Clading[]; state: CladingEditState; setState: (s: CladingEditState) => void; onChange: (c: Clading[]) => void; ppm: number }) {
  const selected = items.find((c) => c.id === state.id);
  return <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
    <Box className="h-4 w-4 text-primary" /><span>Clading</span>
    <Select value={selected?.id ?? ""} onValueChange={(id) => setState({ ...state, id, face: null })}><SelectTrigger aria-label="Pilih clading" className="h-8 w-40"><SelectValue placeholder="Pilih clading" /></SelectTrigger><SelectContent>{items.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
    <div className="flex gap-1" role="group" aria-label="Mode clading">
      <Button size="icon" variant={state.mode === "move" ? "secondary" : "ghost"} aria-label="Geser clading" title="Geser clading" onClick={() => setState({ ...state, mode: "move" })}><Move3d className="h-4 w-4" /></Button>
      <Button size="icon" variant={state.mode === "extrude" ? "secondary" : "ghost"} aria-label="Extrude clading" title="Extrude bidang clading" onClick={() => setState({ ...state, mode: "extrude" })}><ArrowUpFromLine className="h-4 w-4" /></Button>
    </div>
    {state.mode === "move" ? <Select value={state.plane} onValueChange={(plane) => setState({ ...state, plane: plane === "vertical" ? "vertical" : "horizontal" })}><SelectTrigger className="h-8 w-36" aria-label="Bidang gizmo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="horizontal">Horizontal</SelectItem><SelectItem value="vertical">Vertikal</SelectItem></SelectContent></Select> : <>
      <Label className="flex items-center gap-1.5"><Checkbox checked={state.segment} onCheckedChange={(v) => setState({ ...state, segment: v === true, face: null })} />Segmen bidang</Label>
      <Input aria-label="Jarak extrude clading" type="number" step="0.1" className="h-8 w-20" value={state.distance} onChange={(e) => setState({ ...state, distance: e.target.value })} /><span>m</span>
      <Button size="sm" variant="outline" disabled={!selected || !state.face || !Number(state.distance)} onClick={() => {
        if (!selected || !state.face) return;
        onChange(items.map((c) => c.id === selected.id ? extrudeClading(c, state.face as CladingFace, Number(state.distance), ppm) : c));
        setState({ ...state, face: null });
      }}>Terapkan</Button>
    </>}
  </div>;
}

export function CladingEditor({ items, state, setState, onChange, ppm, elevation, cx, cy }: { items: Clading[]; state: CladingEditState; setState: (s: CladingEditState) => void; onChange: (c: Clading[]) => void; ppm: number; elevation: number; cx: number; cy: number }) {
  const handle = useRef<THREE.Group>(null);
  const selected = items.find((c) => c.id === state.id);
  const surfaces = useMemo(() => items.flatMap((c) => cladingFaces(c.boxes).map((face) => ({ item: c, face }))), [items]);
  const center = selected ? {
    x: selected.boxes.reduce((s, b) => s + (b.min.x + b.max.x) / 2, 0) / selected.boxes.length / ppm - cx,
    y: selected.boxes.reduce((s, b) => s + (b.min.z + b.max.z) / 2, 0) / selected.boxes.length - elevation,
    z: selected.boxes.reduce((s, b) => s + (b.min.y + b.max.y) / 2, 0) / selected.boxes.length / ppm - cy,
  } : { x: 0, y: 0, z: 0 };
  const f = state.face;
  const faceCenter = f ? { x: (f.box.min.x + f.box.max.x) / 2 / ppm - cx, y: (f.box.min.z + f.box.max.z) / 2 - elevation, z: (f.box.min.y + f.box.max.y) / 2 / ppm - cy } : center;
  const start = state.mode === "extrude" ? faceCenter : center;
  const selectFace = (event: ThreeEvent<PointerEvent>, item: Clading, face: CladingFace) => {
    event.stopPropagation();
    const box = structuredClone(face.box);
    if (state.segment) {
      const p = { x: (event.point.x + cx) * ppm, y: (event.point.z + cy) * ppm, z: event.point.y + elevation };
      for (const a of ["x", "y", "z"] as const) if (a !== face.axis) {
        const pitch = 0.5 * (a === "z" ? 1 : ppm);
        const low = Math.floor(p[a] / pitch) * pitch;
        box.min[a] = Math.max(box.min[a], low); box.max[a] = Math.min(box.max[a], low + pitch);
      }
    }
    setState({ ...state, id: item.id, face: { ...face, box } });
  };
  return <>
    {surfaces.map(({ item, face }, index) => {
      const b = face.box;
      const size: [number, number, number] = [(b.max.x - b.min.x) / ppm, b.max.z - b.min.z, (b.max.y - b.min.y) / ppm];
      const position: [number, number, number] = [(b.max.x + b.min.x) / 2 / ppm - cx, (b.max.z + b.min.z) / 2 - elevation, (b.max.y + b.min.y) / 2 / ppm - cy];
      const idx = face.axis === "x" ? 0 : face.axis === "z" ? 1 : 2;
      position[idx] += size[idx] * face.sign / 2; size[idx] = 0.004;
      return <mesh key={`${item.id}:${index}`} position={position} onPointerDown={(e) => selectFace(e, item, face)}><boxGeometry args={size} /><meshBasicMaterial transparent opacity={item.id === state.id ? 0.12 : 0} color="var(--clading-selected)" depthWrite={false} /></mesh>;
    })}
    {selected && (state.mode === "move" || f) && <TransformControls key={`${selected.id}:${JSON.stringify(start)}:${state.mode}:${state.plane}`} mode="translate" translationSnap={0.05}
      showX={state.mode === "extrude" ? f?.axis === "x" : state.plane === "horizontal"}
      showY={state.mode === "extrude" ? f?.axis === "z" : state.plane === "vertical"}
      showZ={state.mode === "extrude" ? f?.axis === "y" : state.plane === "horizontal"}
      onMouseUp={() => {
        const object = handle.current; if (!object) return;
        const dx = object.position.x - start.x, dy = object.position.z - start.z, dz = object.position.y - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < 0.001) return;
        if (state.mode === "extrude" && f) {
          const distance = (f.axis === "x" ? dx : f.axis === "y" ? dy : dz) * f.sign;
          onChange(items.map((c) => c.id === selected.id ? extrudeClading(c, f, distance, ppm) : c));
        } else onChange(items.map((c) => c.id === selected.id ? { ...c, boxes: c.boxes.map((b) => ({ min: { x: b.min.x + dx * ppm, y: b.min.y + dy * ppm, z: b.min.z + dz }, max: { x: b.max.x + dx * ppm, y: b.max.y + dy * ppm, z: b.max.z + dz } })) } : c));
        setState({ ...state, face: null });
      }}><group ref={handle} position={[start.x, start.y, start.z]} /></TransformControls>}
  </>;
}