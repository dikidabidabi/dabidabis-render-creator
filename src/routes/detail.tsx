import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ImagePlus,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { colorForRoomName } from "@/lib/room-color";
import { setProjectItem } from "@/lib/storage/idb-bridge";
import {
  FURNITURE_CATALOG,
  newDetailFurniture,
  normalizeDetailFurniture,
  normalizeImportedFurniture,
  type CatalogFurniture,
  type DetailFurniture,
  type ImportedFurniture,
} from "@/lib/detail-furniture";
import { toast } from "sonner";

export const Route = createFileRoute("/detail")({
  head: () => ({
    meta: [
      { title: "Detail — Dabidabi's" },
      { name: "description", content: "Susun furniture pada setiap kotak pendetailan proyek Dabidabi's." },
      { property: "og:title", content: "Detail — Dabidabi's" },
      { property: "og:description", content: "Bidang kerja detail dan penataan furniture per sketsa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DetailPage,
});

type Point = { x: number; y: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type ViewBox = { x: number; y: number; width: number; height: number };
type Line = { a: Point; b: Point; levelId?: string };
type Layer = { id: string; name: string; points: Point[]; color: string; levelId?: string };
type Level = { id: string; name: string };
type DetailArea = { id: string; levelId: string; a: Point; b: Point; number: number; furniture?: DetailFurniture[] };
type Sketch = { id: string; title: string; levels: Level[]; layers: Layer[]; lines?: Line[]; detailAreas?: DetailArea[] };
type StoreShape = { sketches: Sketch[]; openId: string | null };
type MoveGesture = { kind: "move"; start: Point; initial: Map<string, DetailFurniture> };
type ItemGesture = { kind: "rotate" | "scale"; start: Point; initial: DetailFurniture };
type SelectGesture = { kind: "select"; start: Point; current: Point; additive: boolean };
type Gesture = MoveGesture | ItemGesture | SelectGesture;
type Pinch = { distance: number; centerClient: Point; view: ViewBox };

const STORAGE_KEY = "dabidabis_sketch_v2";
const LIBRARY_KEY = "dabidabis_furniture_library_v1";
const CLIPBOARD_KEY = "dabidabis_furniture_clipboard_v1";
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

function boundsFor(area: DetailArea): Bounds {
  return { minX: Math.min(area.a.x, area.b.x), minY: Math.min(area.a.y, area.b.y), maxX: Math.max(area.a.x, area.b.x), maxY: Math.max(area.a.y, area.b.y) };
}

function baseView(bounds: Bounds): ViewBox {
  return { x: bounds.minX, y: bounds.minY, width: Math.max(1, bounds.maxX - bounds.minX), height: Math.max(1, bounds.maxY - bounds.minY) };
}

function DetailPage() {
  const [store, setStore] = useState<StoreShape>({ sketches: [], openId: null });
  const [loaded, setLoaded] = useState(false);
  const [openSketches, setOpenSketches] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ sketchId: string; areaId: string } | null>(null);

  const load = useCallback(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as StoreShape | null;
      if (!parsed || !Array.isArray(parsed.sketches)) return;
      const next = { ...parsed, sketches: parsed.sketches.map((sketch) => ({ ...sketch, detailAreas: (sketch.detailAreas ?? []).map((area) => ({ ...area, furniture: normalizeDetailFurniture(area.furniture) })) })) };
      setStore(next);
      setOpenSketches((current) => current.size > 0 ? current : new Set(next.sketches.map((sketch) => sketch.id)));
      setActive((current) => {
        if (current && next.sketches.some((sketch) => sketch.id === current.sketchId && sketch.detailAreas?.some((area) => area.id === current.areaId))) return current;
        const sketch = next.sketches.find((item) => (item.detailAreas?.length ?? 0) > 0);
        return sketch?.detailAreas?.[0] ? { sketchId: sketch.id, areaId: sketch.detailAreas[0].id } : null;
      });
    } catch {
      toast.error("Data detail tidak dapat dibaca");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) load(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", load);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", load); };
  }, [load]);

  const updateArea = useCallback((sketchId: string, areaId: string, furniture: DetailFurniture[]) => {
    setStore((current) => {
      const next: StoreShape = { ...current, sketches: current.sketches.map((sketch) => sketch.id !== sketchId ? sketch : { ...sketch, detailAreas: (sketch.detailAreas ?? []).map((area) => area.id === areaId ? { ...area, furniture } : area) }) };
      void setProjectItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const activeSketch = active ? store.sketches.find((sketch) => sketch.id === active.sketchId) : undefined;
  const activeArea = activeSketch?.detailAreas?.find((area) => area.id === active?.areaId);

  return <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
    <header className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ember">Project · Detail</p>
      <h1 className="mt-2 font-display text-3xl font-semibold">Detail</h1>
      <p className="mt-1 text-sm text-muted-foreground">Kotak pendetailan dari setiap sketsa, siap dilengkapi dengan furniture.</p>
    </header>
    {!loaded ? <div className="py-16 text-center text-sm text-muted-foreground">Memuat detail proyek…</div> : null}
    {loaded && store.sketches.length === 0 ? <EmptyState text="Belum ada sketsa." /> : null}
    <div className="space-y-4">
      {store.sketches.map((sketch) => {
        const areas = sketch.detailAreas ?? [];
        const expanded = openSketches.has(sketch.id);
        return <section key={sketch.id} className="overflow-hidden rounded-lg border border-border/60 bg-surface/30">
          <Button type="button" variant="ghost" className="h-auto w-full justify-between rounded-none px-4 py-3 text-left" onClick={() => setOpenSketches((current) => {
            const next = new Set(current); if (next.has(sketch.id)) next.delete(sketch.id); else next.add(sketch.id); return next;
          })}>
            <span><span className="block font-display text-base font-semibold">{sketch.title}</span><span className="text-xs text-muted-foreground">{areas.length} kotak detail</span></span>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          {expanded && <div className="border-t border-border/50 p-3">
            {areas.length === 0 ? <p className="px-1 py-3 text-sm text-muted-foreground">Belum ada kotak detail pada sketsa ini.</p> : <div className="flex flex-wrap gap-2">
              {areas.map((area) => {
                const level = sketch.levels.find((item) => item.id === area.levelId);
                const selected = active?.sketchId === sketch.id && active.areaId === area.id;
                return <Button key={area.id} variant={selected ? "default" : "outline"} onClick={() => setActive({ sketchId: sketch.id, areaId: area.id })}>Detail {area.number} · {level?.name ?? "Level"}</Button>;
              })}
            </div>}
          </div>}
        </section>;
      })}
    </div>
    {activeSketch && activeArea ? <DetailWorkspace key={`${activeSketch.id}-${activeArea.id}`} sketch={activeSketch} area={activeArea} onFurnitureChange={(items) => updateArea(activeSketch.id, activeArea.id, items)} /> : loaded ? <EmptyState text="Buat kotak dengan alat Pendetailan di halaman Sketsa untuk mulai menata furniture." /> : null}
  </main>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="mt-6 border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">{text}</div>;
}

function DetailWorkspace({ sketch, area, onFurnitureChange }: { sketch: Sketch; area: DetailArea; onFurnitureChange: (items: DetailFurniture[]) => void }) {
  const workspaceRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<Pinch | null>(null);
  const bounds = useMemo(() => boundsFor(area), [area]);
  const initialView = useMemo(() => baseView(bounds), [bounds]);
  const [view, setView] = useState<ViewBox>(initialView);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [library, setLibrary] = useState<ImportedFurniture[]>([]);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const furniture = area.furniture ?? [];
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const level = sketch.levels.find((item) => item.id === area.levelId);
  const layers = sketch.layers.filter((item) => item.levelId === area.levelId);
  const lines = (sketch.lines ?? []).filter((item) => item.levelId === area.levelId);
  const zoom = width / view.width;

  useEffect(() => {
    try {
      setLibrary(normalizeImportedFurniture(JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]")));
      setHasClipboard(normalizeDetailFurniture(JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || "[]")).length > 0);
    } catch { setLibrary([]); }
  }, []);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  const clientToSvg = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return { x: view.x + ((clientX - rect.left) / rect.width) * view.width, y: view.y + ((clientY - rect.top) / rect.height) * view.height };
  }, [view]);

  const zoomAt = useCallback((factor: number, client?: Point) => {
    setView((current) => {
      const nextWidth = Math.min(initialView.width / MIN_ZOOM, Math.max(initialView.width / MAX_ZOOM, current.width / factor));
      const nextHeight = nextWidth * (current.height / current.width);
      const svgRect = svgRef.current?.getBoundingClientRect();
      const anchor = client && svgRect ? { x: current.x + ((client.x - svgRect.left) / svgRect.width) * current.width, y: current.y + ((client.y - svgRect.top) / svgRect.height) * current.height } : { x: current.x + current.width / 2, y: current.y + current.height / 2 };
      const rx = (anchor.x - current.x) / current.width;
      const ry = (anchor.y - current.y) / current.height;
      return { x: anchor.x - rx * nextWidth, y: anchor.y - ry * nextHeight, width: nextWidth, height: nextHeight };
    });
  }, [initialView]);

  const saveLibrary = useCallback((next: ImportedFurniture[]) => {
    setLibrary(next);
    void setProjectItem(LIBRARY_KEY, JSON.stringify(next));
  }, []);

  const copySelection = useCallback(() => {
    const copied = furniture.filter((item) => selectedIds.has(item.id));
    if (copied.length === 0) return;
    void setProjectItem(CLIPBOARD_KEY, JSON.stringify(copied));
    setHasClipboard(true);
    toast.success(`${copied.length} furniture disalin`);
  }, [furniture, selectedIds]);

  const pasteSelection = useCallback(() => {
    try {
      const copied = normalizeDetailFurniture(JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || "[]"));
      if (copied.length === 0) { toast.error("Belum ada furniture yang disalin"); return; }
      const sourceCenter = { x: (Math.min(...copied.map((item) => item.x)) + Math.max(...copied.map((item) => item.x))) / 2, y: (Math.min(...copied.map((item) => item.y)) + Math.max(...copied.map((item) => item.y))) / 2 };
      const target = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      const stamp = Date.now();
      const pasted = copied.map((item, index) => ({ ...item, id: `FURN${stamp}_${index}_${Math.random().toString(36).slice(2, 6)}`, x: target.x + item.x - sourceCenter.x, y: target.y + item.y - sourceCenter.y, createdAt: stamp + index }));
      onFurnitureChange([...furniture, ...pasted]);
      setSelectedIds(new Set(pasted.map((item) => item.id)));
      toast.success(`${pasted.length} furniture ditempel`);
    } catch { toast.error("Furniture salinan tidak dapat dibaca"); }
  }, [bounds, furniture, onFurnitureChange]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelection(); }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.size > 0) {
        event.preventDefault(); onFurnitureChange(furniture.filter((item) => !selectedIds.has(item.id))); setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, furniture, onFurnitureChange, pasteSelection, selectedIds]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...pointersRef.current.values()];
      if (points.length >= 2 && pinchRef.current) {
        const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
        const centerClient = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
        const pinch = pinchRef.current;
        const factor = distance / pinch.distance;
        const nextWidth = Math.min(initialView.width / MIN_ZOOM, Math.max(initialView.width / MAX_ZOOM, pinch.view.width / factor));
        const nextHeight = nextWidth * (pinch.view.height / pinch.view.width);
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect) {
          const anchor = { x: pinch.view.x + ((pinch.centerClient.x - rect.left) / rect.width) * pinch.view.width, y: pinch.view.y + ((pinch.centerClient.y - rect.top) / rect.height) * pinch.view.height };
          const panX = ((centerClient.x - pinch.centerClient.x) / rect.width) * nextWidth;
          const panY = ((centerClient.y - pinch.centerClient.y) / rect.height) * nextHeight;
          setView({ x: anchor.x - nextWidth / 2 - panX, y: anchor.y - nextHeight / 2 - panY, width: nextWidth, height: nextHeight });
        }
        return;
      }
      const gesture = gestureRef.current;
      if (!gesture) return;
      const point = clientToSvg(event.clientX, event.clientY);
      if (gesture.kind === "move") {
        const dx = point.x - gesture.start.x; const dy = point.y - gesture.start.y;
        onFurnitureChange(furniture.map((item) => { const original = gesture.initial.get(item.id); return original ? { ...item, x: original.x + dx, y: original.y + dy } : item; }));
      } else if (gesture.kind === "rotate") {
        const angle = Math.atan2(point.y - gesture.initial.y, point.x - gesture.initial.x) * 180 / Math.PI + 90;
        onFurnitureChange(furniture.map((item) => item.id === gesture.initial.id ? { ...item, rotation: Math.round(angle / 5) * 5 } : item));
      } else if (gesture.kind === "scale") {
        const initialDistance = Math.max(1, Math.hypot(gesture.start.x - gesture.initial.x, gesture.start.y - gesture.initial.y));
        const factor = Math.max(0.15, Math.hypot(point.x - gesture.initial.x, point.y - gesture.initial.y) / initialDistance);
        onFurnitureChange(furniture.map((item) => item.id === gesture.initial.id ? { ...item, width: gesture.initial.width * factor, height: gesture.initial.height * factor } : item));
      } else {
        gestureRef.current = { ...gesture, current: point };
        const minX = Math.min(gesture.start.x, point.x), maxX = Math.max(gesture.start.x, point.x), minY = Math.min(gesture.start.y, point.y), maxY = Math.max(gesture.start.y, point.y);
        const hits = furniture.filter((item) => item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY).map((item) => item.id);
        setSelectedIds((current) => new Set(gesture.additive ? [...current, ...hits] : hits));
      }
    };
    const up = (event: PointerEvent) => {
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (pointersRef.current.size === 0) gestureRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [clientToSvg, furniture, initialView, onFurnitureChange]);

  const registerPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)), centerClient: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, view };
      gestureRef.current = null;
    }
  };

  const addFurniture = (entry: CatalogFurniture) => {
    const item = newDetailFurniture(entry, bounds);
    onFurnitureChange([...furniture, item]); setSelectedIds(new Set([item.id]));
  };

  const importImage = (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { toast.error("Pilih file gambar PNG, JPG, atau WebP"); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error("Ukuran gambar maksimal 20 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const image = new Image();
      image.onload = () => {
        const entry: ImportedFurniture = { id: `CUSTOM${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: file.name.replace(/\.[^.]+$/, ""), imageUrl: reader.result as string, aspectRatio: image.width / Math.max(1, image.height), importedAt: Date.now() };
        const duplicate = library.find((item) => item.imageUrl === entry.imageUrl);
        if (!duplicate) saveLibrary([...library, entry]);
        addFurniture(duplicate ?? entry);
        toast.success(duplicate ? "Furniture ditambahkan dari pustaka" : "Furniture diimpor dan disimpan ke pustaka");
      };
      image.onerror = () => toast.error("Gambar tidak dapat dibaca");
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const selectionBox = gestureRef.current?.kind === "select" ? gestureRef.current : null;
  const onlySelected = selectedIds.size === 1 ? furniture.find((item) => selectedIds.has(item.id)) : undefined;

  return <section ref={workspaceRef} className={fullscreen ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background" : "mt-6 overflow-hidden rounded-lg border border-border/60 bg-card"}>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
      <div><h2 className="font-display text-lg font-semibold">{sketch.title} · Detail {area.number}</h2><p className="text-xs text-muted-foreground">{level?.name ?? "Level"}</p></div>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" title="Perkecil" onClick={() => zoomAt(0.8)}><Minus className="h-4 w-4" /></Button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon" variant="ghost" title="Perbesar" onClick={() => zoomAt(1.25)}><Plus className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" title="Kembali ke ukuran awal" onClick={() => setView(initialView)}><RotateCcw className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" title={fullscreen ? "Keluar layar penuh" : "Layar penuh"} onClick={() => fullscreen ? void document.exitFullscreen() : void workspaceRef.current?.requestFullscreen()}>{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</Button>
      </div>
    </div>
    <div className={`grid min-h-0 flex-1 ${fullscreen ? "lg:grid-cols-[minmax(0,1fr)_280px]" : "min-h-[620px] lg:grid-cols-[minmax(0,1fr)_260px]"}`}>
      <div className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-muted/30 p-3 sm:p-6">
        <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} className={fullscreen ? "h-full w-full border border-border bg-background" : "max-h-[72vh] w-full border border-border bg-background shadow-sm"} style={{ aspectRatio: `${width}/${height}`, touchAction: "none" }}
          onWheel={(event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, { x: event.clientX, y: event.clientY }); }}
          onPointerDown={(event) => { registerPointer(event); if (pointersRef.current.size > 1) return; const point = clientToSvg(event.clientX, event.clientY); gestureRef.current = { kind: "select", start: point, current: point, additive: event.shiftKey || event.ctrlKey || event.metaKey }; if (!(event.shiftKey || event.ctrlKey || event.metaKey)) setSelectedIds(new Set()); }}>
          <rect x={view.x} y={view.y} width={view.width} height={view.height} className="fill-background" />
          {layers.map((layer) => <polygon key={layer.id} points={layer.points.map((point) => `${point.x},${point.y}`).join(" ")} fill={(colorForRoomName(layer.name) ?? layer.color ?? "rgba(210,210,210,ALPHA)").replace("ALPHA", "0.16")} className="stroke-border" strokeWidth={Math.max(width, height) * 0.001 / zoom} />)}
          <g className="stroke-foreground" fill="none" strokeWidth={Math.max(width, height) * 0.002 / zoom}>{lines.map((line, index) => <line key={index} x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} />)}</g>
          {furniture.map((item) => {
            const selected = selectedIds.has(item.id); const handle = Math.max(width, height) * 0.014 / zoom;
            return <g key={item.id} transform={`rotate(${item.rotation} ${item.x} ${item.y})`} onPointerDown={(event) => {
              event.stopPropagation(); registerPointer(event); if (pointersRef.current.size > 1) return;
              const additive = event.shiftKey || event.ctrlKey || event.metaKey;
              const next = additive ? new Set(selectedIds) : selected ? new Set(selectedIds) : new Set<string>();
              if (additive && next.has(item.id)) next.delete(item.id); else next.add(item.id);
              setSelectedIds(next);
              const idsToMove = next.has(item.id) ? next : new Set([item.id]);
              gestureRef.current = { kind: "move", start: clientToSvg(event.clientX, event.clientY), initial: new Map(furniture.filter((entry) => idsToMove.has(entry.id)).map((entry) => [entry.id, { ...entry }])) };
            }}>
              <image href={item.imageUrl} x={item.x - item.width / 2} y={item.y - item.height / 2} width={item.width} height={item.height} preserveAspectRatio="none" />
              {selected && <rect x={item.x - item.width / 2} y={item.y - item.height / 2} width={item.width} height={item.height} fill="none" className="stroke-ember" strokeWidth={handle * 0.13} strokeDasharray={`${handle * 0.45} ${handle * 0.3}`} />}
              {selected && selectedIds.size === 1 ? <>
                <g transform={`translate(${item.x + item.width / 2} ${item.y - item.height / 2})`} onPointerDown={(event) => { event.stopPropagation(); const point = clientToSvg(event.clientX, event.clientY); gestureRef.current = { kind: "rotate", start: point, initial: { ...item } }; }}><circle r={handle} className="fill-ember stroke-background" strokeWidth={handle * 0.12} /><RotateCw x={-handle * 0.55} y={-handle * 0.55} width={handle * 1.1} height={handle * 1.1} className="text-primary-foreground" /></g>
                <rect x={item.x + item.width / 2 - handle} y={item.y + item.height / 2 - handle} width={handle * 2} height={handle * 2} rx={handle * 0.2} className="fill-ember stroke-background" strokeWidth={handle * 0.12} onPointerDown={(event) => { event.stopPropagation(); const point = clientToSvg(event.clientX, event.clientY); gestureRef.current = { kind: "scale", start: point, initial: { ...item } }; }} />
              </> : null}
            </g>;
          })}
          {selectionBox ? <rect x={Math.min(selectionBox.start.x, selectionBox.current.x)} y={Math.min(selectionBox.start.y, selectionBox.current.y)} width={Math.abs(selectionBox.current.x - selectionBox.start.x)} height={Math.abs(selectionBox.current.y - selectionBox.start.y)} className="fill-ember/10 stroke-ember" strokeWidth={Math.max(width, height) * 0.0015 / zoom} strokeDasharray={`${Math.max(width, height) * 0.008 / zoom} ${Math.max(width, height) * 0.005 / zoom}`} pointerEvents="none" /> : null}
        </svg>
      </div>
      <aside className="min-h-0 overflow-y-auto border-t border-border/60 bg-surface/40 p-4 lg:border-l lg:border-t-0">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-display text-sm font-semibold">Furniture</h3><span className="text-xs text-muted-foreground">{selectedIds.size} dipilih</span></div>
        <div className="mb-4 grid grid-cols-3 gap-1">
          <Button size="sm" variant="outline" disabled={selectedIds.size === 0} title="Salin pilihan" onClick={copySelection}><Copy className="mr-1 h-3.5 w-3.5" />Salin</Button>
          <Button size="sm" variant="outline" disabled={!hasClipboard} title="Tempel ke tengah detail" onClick={pasteSelection}><ImagePlus className="mr-1 h-3.5 w-3.5" />Tempel</Button>
          <Button size="sm" variant="outline" disabled={selectedIds.size === 0} title="Hapus pilihan" onClick={() => { onFurnitureChange(furniture.filter((item) => !selectedIds.has(item.id))); setSelectedIds(new Set()); }}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {FURNITURE_CATALOG.map((item) => <Button key={item.id} type="button" variant="outline" className="h-auto flex-col gap-1 rounded-none p-2" onClick={() => addFurniture(item)}><img src={item.imageUrl} alt="" className="h-16 w-full object-contain" draggable={false} /><span className="mt-1 block w-full truncate text-center text-[11px] font-medium">{item.name}</span></Button>)}
        </div>
        {library.length > 0 ? <><div className="mb-2 mt-5 text-[11px] font-semibold uppercase text-muted-foreground">Pustaka impor</div><div className="grid grid-cols-2 gap-2">{library.map((item) => <div key={item.id} className="relative"><Button type="button" variant="outline" className="h-auto w-full flex-col gap-1 rounded-none p-2" onClick={() => addFurniture(item)}><img src={item.imageUrl} alt="" className="h-16 w-full object-contain" draggable={false} /><span className="mt-1 block w-full truncate text-center text-[11px] font-medium">{item.name}</span></Button><Button size="icon" variant="secondary" className="absolute right-1 top-1 h-6 w-6" title="Hapus dari pustaka" onClick={() => saveLibrary(library.filter((entry) => entry.id !== item.id))}><X className="h-3 w-3" /></Button></div>)}</div></> : null}
        <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importImage(file); event.currentTarget.value = ""; }} />
        <Button variant="outline" className="mt-3 w-full" onClick={() => uploadRef.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />Impor gambar</Button>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Cubit dua jari atau gunakan roda untuk zoom. Tarik area kosong untuk memilih beberapa furniture.</p>
        {onlySelected ? <div className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">Rotasi {onlySelected.rotation}° · snap 5°</div> : null}
      </aside>
    </div>
  </section>;
}
