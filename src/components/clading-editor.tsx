import { useEffect, useMemo, useRef, useState } from "react";
import { TransformControls } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { Box, Move3d, ArrowUpFromLine, Scan, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cladingFaces, extrudeCladingFaces, moveClading, snapCladingDistance, type Clading, type CladingFace } from "@/lib/clading";
import { sameSide, segmentFaces } from "@/lib/clading-solid";

export type CladingEditState = { id: string; face: CladingFace | null; faces: CladingFace[]; mode: "move" | "extrude"; plane: "horizontal" | "vertical"; segment: boolean; distance: string };
export const initialCladingEdit: CladingEditState = { id: "", face: null, faces: [], mode: "move", plane: "horizontal", segment: true, distance: "0.5" };
export function CladingEditPanel({ items, state, setState, onChange, ppm, snapStep }: { items: Clading[]; state: CladingEditState; setState: (s: CladingEditState) => void; onChange: (c: Clading[]) => void; ppm: number; snapStep: number }) {
  const selected = items.find((c) => c.id === state.id);
  return <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
    <Box className="h-4 w-4 text-primary" /><span>Clading</span>
    <Select value={selected?.id ?? ""} onValueChange={(id) => setState({ ...state, id, face: null, faces: [] })}><SelectTrigger aria-label="Pilih clading" className="h-8 w-40"><SelectValue placeholder="Pilih clading" /></SelectTrigger><SelectContent>{items.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
    <div className="flex gap-1" role="group" aria-label="Mode clading">
      <Button size="icon" variant={state.mode === "move" ? "secondary" : "ghost"} aria-label="Geser clading" title="Geser clading" onClick={() => setState({ ...state, mode: "move", face:null, faces:[] })}><Move3d className="h-4 w-4" /></Button>
      <Button size="icon" variant={state.mode === "extrude" ? "secondary" : "ghost"} aria-label="Extrude clading" title="Extrude bidang clading" onClick={() => setState({ ...state, mode: "extrude",face:null,faces:[] })}><ArrowUpFromLine className="h-4 w-4" /></Button>
    </div>
    {state.mode === "move" ? <Select value={state.plane} onValueChange={(plane) => setState({ ...state, plane: plane === "vertical" ? "vertical" : "horizontal" })}><SelectTrigger className="h-8 w-36" aria-label="Bidang gizmo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="horizontal">Horizontal</SelectItem><SelectItem value="vertical">Vertikal</SelectItem></SelectContent></Select> : <>
      <Label className="flex items-center gap-1.5"><Checkbox checked={state.segment} onCheckedChange={(v) => setState({ ...state, segment: v === true, face: null, faces: [] })} />Segmen bidang</Label>
      <Scan className="h-3.5 w-3.5 text-muted-foreground" /><span aria-label="Jumlah segmen terpilih">{state.faces.length} segmen</span>
      {state.faces.length>0 && <Button size="icon" variant="ghost" aria-label="Batalkan seleksi segmen" title="Batalkan seleksi segmen" onClick={()=>setState({...state,face:null,faces:[]})}><X className="h-3.5 w-3.5" /></Button>}
      <Input aria-label="Jarak extrude clading" type="number" step={snapStep} className="h-8 w-20" value={state.distance} onChange={(e) => setState({ ...state, distance: e.target.value })} /><span>m</span>
      <Button size="sm" variant="outline" disabled={!selected || !state.faces.length || !Number(state.distance)} onClick={() => {
        if (!selected) return;
        const distance=snapCladingDistance(Number(state.distance),snapStep);
        onChange(items.map((c) => c.id === selected.id ? extrudeCladingFaces(c, state.faces, distance, ppm) : c));
        setState({ ...state, face: null, faces:[] });
      }}>Terapkan</Button>
    </>}
    <span className="text-muted-foreground">Snap {Math.round(snapStep*1000)} mm</span>
  </div>;
}
function faceGeometry(face:CladingFace,ppm:number,elevation:number,cx:number,cy:number):THREE.BufferGeometry {
  const geometry=new THREE.BufferGeometry();let points:THREE.Vector3[]=[];
  if(face.edge){const {a,b}=face.edge,n=face.normal??{x:0,y:0},offset=0.003;points=[new THREE.Vector3(a.x/ppm-cx+n.x*offset,face.box.min.z-elevation,a.y/ppm-cy+n.y*offset),new THREE.Vector3(b.x/ppm-cx+n.x*offset,face.box.min.z-elevation,b.y/ppm-cy+n.y*offset),new THREE.Vector3(b.x/ppm-cx+n.x*offset,face.box.max.z-elevation,b.y/ppm-cy+n.y*offset),new THREE.Vector3(a.x/ppm-cx+n.x*offset,face.box.max.z-elevation,a.y/ppm-cy+n.y*offset)];}
  else{const z=(face.sign>0?face.box.max.z:face.box.min.z)-elevation+face.sign*0.003;points=(face.polygon??[]).map(p=>new THREE.Vector3(p.x/ppm-cx,z,p.y/ppm-cy));}
  const contour=face.edge?points.map(p=>new THREE.Vector2(p.distanceTo(points[0]??p),p.y)):points.map(p=>new THREE.Vector2(p.x,p.z));
  const indices=face.edge?[0,1,2,0,2,3]:THREE.ShapeUtils.triangulateShape(contour,[]).flat();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(points.flatMap(p=>[p.x,p.y,p.z]),3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
const faceKey=(face:CladingFace)=>JSON.stringify([face.axis,face.sign,face.box,face.edge,face.polygon]);
export function CladingEditor({ items, state, setState, onChange, onPreview, ppm, snapStep, elevation, cx, cy }: { items: Clading[]; state: CladingEditState; setState: (s: CladingEditState) => void; onChange: (c: Clading[]) => void; onPreview:(c:Clading[]|null)=>void; ppm: number; snapStep:number; elevation: number; cx: number; cy: number }) {
  const handle=useRef<THREE.Group>(null), {camera,gl,controls}=useThree();
  const [selectionColor,setSelectionColor]=useState<string>();
  useEffect(()=>{const swatch=document.createElement("span");swatch.className="clading-selection-swatch";gl.domElement.parentElement?.append(swatch);setSelectionColor(getComputedStyle(swatch).color);swatch.remove();},[gl]);
  const selected=items.find(c=>c.id===state.id);
  const surfaces=useMemo(()=>items.flatMap(item=>cladingFaces(item.boxes).flatMap(face=>(state.mode==="extrude"&&state.segment?segmentFaces(face,ppm):[face]).map(face=>({item,face,key:faceKey(face),geometry:faceGeometry(face,ppm,elevation,cx,cy)})))),[items,state.mode,state.segment,ppm,elevation,cx,cy]);
  useEffect(()=>()=>surfaces.forEach(s=>s.geometry.dispose()),[surfaces]);
  const center=selected?new THREE.Vector3(selected.boxes.reduce((s,b)=>s+(b.min.x+b.max.x)/2,0)/selected.boxes.length/ppm-cx,selected.boxes.reduce((s,b)=>s+(b.min.z+b.max.z)/2,0)/selected.boxes.length-elevation,selected.boxes.reduce((s,b)=>s+(b.min.y+b.max.y)/2,0)/selected.boxes.length/ppm-cy):new THREE.Vector3();
  const f=state.face;
  const start=state.mode==="extrude"&&f?new THREE.Vector3((f.box.min.x+f.box.max.x)/2/ppm-cx,(f.axis==="z"?(f.sign>0?f.box.max.z:f.box.min.z):(f.box.min.z+f.box.max.z)/2)-elevation,(f.box.min.y+f.box.max.y)/2/ppm-cy):center;
  const normal=f?.edge&&f.normal?new THREE.Vector3(f.normal.x,0,f.normal.y):new THREE.Vector3(0,f?.sign??1,0);
  const rotation=state.mode==="extrude"?new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0),normal):new THREE.Quaternion();
  const selectedKeys=new Set(state.faces.map(faceKey));
  const drag=useRef<{x:number;y:number;pointer:number;item:Clading;face:CladingFace;additive:boolean;prior:CladingFace[];box:HTMLDivElement}|null>(null);
  const latest=useRef({state,setState,surfaces,camera,gl,controls});latest.current={state,setState,surfaces,camera,gl,controls};
  useEffect(()=>{
    const update=(e:PointerEvent,finish=false)=>{
      const d=drag.current;if(!d||e.pointerId!==d.pointer)return;
      const {state,setState,surfaces,camera,gl,controls}=latest.current,rect=gl.domElement.getBoundingClientRect();
      const x0=Math.min(d.x,e.clientX)-rect.left,x1=Math.max(d.x,e.clientX)-rect.left,y0=Math.min(d.y,e.clientY)-rect.top,y1=Math.max(d.y,e.clientY)-rect.top;
      const moved=Math.hypot(e.clientX-d.x,e.clientY-d.y)>5;
      Object.assign(d.box.style,{left:`${x0}px`,top:`${y0}px`,width:`${x1-x0}px`,height:`${y1-y0}px`,display:moved?"block":"none"});
      if(finish){
        const chosen=moved?surfaces.filter(s=>s.item.id===d.item.id&&sameSide(d.face,s.face)).filter(s=>{
          s.geometry.computeBoundingSphere();const p=s.geometry.boundingSphere?.center.clone();if(!p)return false;p.project(camera);const x=(p.x+1)*rect.width/2,y=(1-p.y)*rect.height/2;return p.z>=-1&&p.z<=1&&x>=x0&&x<=x1&&y>=y0&&y<=y1;
        }).map(s=>s.face):[d.face];
        const prior=d.additive?d.prior.filter(face=>sameSide(face,d.face)):[];
        const map=new Map(prior.map(face=>[faceKey(face),face]));for(const face of chosen){const key=faceKey(face);if(d.additive&&!moved&&map.has(key))map.delete(key);else map.set(key,face);}
        const faces=[...map.values()];setState({...state,id:d.item.id,face:faces[0]??null,faces});
        d.box.remove();drag.current=null;
        if(controls&&"enabled" in controls)controls.enabled=true;
      }
    };
    const move=(e:PointerEvent)=>update(e),up=(e:PointerEvent)=>update(e,true),cancel=()=>{drag.current?.box.remove();drag.current=null;if(controls&&"enabled" in controls)controls.enabled=true;};
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);window.addEventListener("pointercancel",cancel);
    return()=>{cancel();window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",cancel);};
  },[controls]);
  const selectFace=(event:ThreeEvent<PointerEvent>,item:Clading,face:CladingFace)=>{
    if(event.button!==0)return;event.stopPropagation();
    if(state.mode==="move"){setState({...state,id:item.id,face:null,faces:[]});return;}
    if(controls&&"enabled" in controls)controls.enabled=false;
    const box=document.createElement("div");box.className="clading-marquee";box.setAttribute("aria-label","Marquee segmen clading");gl.domElement.parentElement?.append(box);
    drag.current={x:event.clientX,y:event.clientY,pointer:event.pointerId,item,face,additive:event.shiftKey||event.ctrlKey||event.metaKey,prior:state.id===item.id?state.faces:[],box};
  };
  const dragging=useRef(false);
  const transformed=()=>{
    const object=handle.current;if(!object||!selected)return null;
    const delta=object.position.clone().sub(start);
    if(state.mode==="extrude"&&f){const distance=snapCladingDistance(delta.dot(normal),snapStep);return items.map(c=>c.id===selected.id?extrudeCladingFaces(c,state.faces,distance,ppm):c);}
    return items.map(c=>c.id===selected.id?moveClading(c,snapCladingDistance(delta.x,snapStep)*ppm,snapCladingDistance(delta.z,snapStep)*ppm,snapCladingDistance(delta.y,snapStep)):c);
  };
  return <>
    {surfaces.map(s=><mesh key={`${s.item.id}:${s.key}`} geometry={s.geometry} onPointerDown={e=>selectFace(e,s.item,s.face)} renderOrder={20}><meshBasicMaterial transparent opacity={s.item.id===state.id&&selectedKeys.has(s.key)?0.4:0} color={selectionColor} depthWrite={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} /></mesh>)}
    {selected&&(state.mode==="move"||f)&&<TransformControls key={`${selected.id}:${JSON.stringify(start)}:${state.mode}:${state.plane}`} mode="translate" space={state.mode==="extrude"?"local":"world"} translationSnap={snapStep}
      showX={state.mode==="extrude"||state.plane==="horizontal"} showY={state.mode==="move"&&state.plane==="vertical"} showZ={state.mode==="move"&&state.plane==="horizontal"}
      onMouseDown={()=>{dragging.current=true;}}
      onObjectChange={()=>{if(dragging.current)onPreview(transformed());}}
      onMouseUp={()=>{dragging.current=false;const next=transformed();onPreview(null);if(next)onChange(next);setState({...state,face:null,faces:[]});}}
    ><group ref={handle} position={start} quaternion={rotation} /></TransformControls>}
  </>;
}
