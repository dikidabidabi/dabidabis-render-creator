import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { colorForRoomName } from "@/lib/room-color";
import { setProjectItem } from "@/lib/storage/idb-bridge";
import {
  FURNITURE_CATALOG,
  newDetailFurniture,
  normalizeDetailFurniture,
  type DetailFurniture,
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
type Line = { a: Point; b: Point; levelId?: string };
type Layer = { id: string; name: string; points: Point[]; color: string; levelId?: string };
type Level = { id: string; name: string };
type DetailArea = {
  id: string;
  levelId: string;
  a: Point;
  b: Point;
  number: number;
  furniture?: DetailFurniture[];
};
type Sketch = {
  id: string;
  title: string;
  levels: Level[];
  layers: Layer[];
  lines?: Line[];
  detailAreas?: DetailArea[];
};
type StoreShape = { sketches: Sketch[]; openId: string | null };
type Gesture = {
  kind: "move" | "rotate" | "scale";
  furnitureId: string;
  start: Point;
  initial: DetailFurniture;
};

const STORAGE_KEY = "dabidabis_sketch_v2";

function boundsFor(area: DetailArea) {
  return {
    minX: Math.min(area.a.x, area.b.x),
    minY: Math.min(area.a.y, area.b.y),
    maxX: Math.max(area.a.x, area.b.x),
    maxY: Math.max(area.a.y, area.b.y),
  };
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
      const next = {
        ...parsed,
        sketches: parsed.sketches.map((sketch) => ({
          ...sketch,
          detailAreas: (sketch.detailAreas ?? []).map((area) => ({
            ...area,
            furniture: normalizeDetailFurniture(area.furniture),
          })),
        })),
      };
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
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) load();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const updateArea = useCallback((sketchId: string, areaId: string, furniture: DetailFurniture[]) => {
    setStore((current) => {
      const next: StoreShape = {
        ...current,
        sketches: current.sketches.map((sketch) => sketch.id !== sketchId ? sketch : {
          ...sketch,
          detailAreas: (sketch.detailAreas ?? []).map((area) => area.id === areaId ? { ...area, furniture } : area),
        }),
      };
      const payload = JSON.stringify(next);
      void setProjectItem(STORAGE_KEY, payload);
      return next;
    });
  }, []);

  const activeSketch = active ? store.sketches.find((sketch) => sketch.id === active.sketchId) : undefined;
  const activeArea = activeSketch?.detailAreas?.find((area) => area.id === active?.areaId);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
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
          return (
            <section key={sketch.id} className="overflow-hidden rounded-lg border border-border/60 bg-surface/30">
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full justify-between rounded-none px-4 py-3 text-left"
                onClick={() => setOpenSketches((current) => {
                  const next = new Set(current);
                  if (next.has(sketch.id)) next.delete(sketch.id); else next.add(sketch.id);
                  return next;
                })}
              >
                <span>
                  <span className="block font-display text-base font-semibold">{sketch.title}</span>
                  <span className="text-xs text-muted-foreground">{areas.length} kotak detail</span>
                </span>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
              {expanded && (
                <div className="border-t border-border/50 p-3">
                  {areas.length === 0 ? <p className="px-1 py-3 text-sm text-muted-foreground">Belum ada kotak detail pada sketsa ini.</p> : (
                    <div className="flex flex-wrap gap-2">
                      {areas.map((area) => {
                        const level = sketch.levels.find((item) => item.id === area.levelId);
                        const selected = active?.sketchId === sketch.id && active.areaId === area.id;
                        return <Button key={area.id} variant={selected ? "default" : "outline"} onClick={() => setActive({ sketchId: sketch.id, areaId: area.id })}>
                          Detail {area.number} · {level?.name ?? "Level"}
                        </Button>;
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {activeSketch && activeArea ? (
        <DetailWorkspace
          key={`${activeSketch.id}-${activeArea.id}`}
          sketch={activeSketch}
          area={activeArea}
          onFurnitureChange={(furniture) => updateArea(activeSketch.id, activeArea.id, furniture)}
        />
      ) : loaded ? <EmptyState text="Buat kotak dengan alat Pendetailan di halaman Sketsa untuk mulai menata furniture." /> : null}
    </main>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="mt-6 border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">{text}</div>;
}

function DetailWorkspace({ sketch, area, onFurnitureChange }: { sketch: Sketch; area: DetailArea; onFurnitureChange: (items: DetailFurniture[]) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const furniture = area.furniture ?? [];
  const bounds = boundsFor(area);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const level = sketch.levels.find((item) => item.id === area.levelId);
  const layers = sketch.layers.filter((item) => item.levelId === area.levelId);
  const lines = (sketch.lines ?? []).filter((item) => item.levelId === area.levelId);

  const clientToSvg = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }, []);

  const replaceFurniture = useCallback((id: string, patch: Partial<DetailFurniture>) => {
    onFurnitureChange(furniture.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, [furniture, onFurnitureChange]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const point = clientToSvg(event.clientX, event.clientY);
      if (gesture.kind === "move") {
        replaceFurniture(gesture.furnitureId, {
          x: gesture.initial.x + point.x - gesture.start.x,
          y: gesture.initial.y + point.y - gesture.start.y,
        });
      } else if (gesture.kind === "rotate") {
        const angle = Math.atan2(point.y - gesture.initial.y, point.x - gesture.initial.x) * 180 / Math.PI + 90;
        replaceFurniture(gesture.furnitureId, { rotation: Math.round(angle / 5) * 5 });
      } else {
        const initialDistance = Math.max(1, Math.hypot(gesture.start.x - gesture.initial.x, gesture.start.y - gesture.initial.y));
        const distance = Math.hypot(point.x - gesture.initial.x, point.y - gesture.initial.y);
        const factor = Math.max(0.15, distance / initialDistance);
        replaceFurniture(gesture.furnitureId, { width: gesture.initial.width * factor, height: gesture.initial.height * factor });
      }
    };
    const up = () => { gestureRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [clientToSvg, replaceFurniture]);

  const addFurniture = (entry: (typeof FURNITURE_CATALOG)[number]) => {
    const item = newDetailFurniture(entry, bounds);
    onFurnitureChange([...furniture, item]);
    setSelectedId(item.id);
  };

  const importImage = (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { toast.error("Pilih file gambar PNG, JPG, atau WebP"); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error("Ukuran gambar maksimal 20 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const image = new Image();
      image.onload = () => {
        const item = newDetailFurniture({ name: file.name.replace(/\.[^.]+$/, ""), imageUrl: reader.result as string, aspectRatio: image.width / Math.max(1, image.height) }, bounds);
        onFurnitureChange([...furniture, item]);
        setSelectedId(item.id);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-border/60 bg-card">
      <div className="border-b border-border/60 px-4 py-3">
        <h2 className="font-display text-lg font-semibold">{sketch.title} · Detail {area.number}</h2>
        <p className="text-xs text-muted-foreground">{level?.name ?? "Level"}</p>
      </div>
      <div className="grid min-h-[620px] lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 items-center justify-center overflow-hidden bg-muted/30 p-3 sm:p-6">
          <svg
            ref={svgRef}
            viewBox={`${bounds.minX} ${bounds.minY} ${width} ${height}`}
            className="max-h-[72vh] w-full border border-border bg-background shadow-sm"
            style={{ aspectRatio: `${width}/${height}`, touchAction: "none" }}
            onPointerDown={() => setSelectedId(null)}
          >
            <rect x={bounds.minX} y={bounds.minY} width={width} height={height} className="fill-background" />
            {layers.map((layer) => <polygon key={layer.id} points={layer.points.map((point) => `${point.x},${point.y}`).join(" ")} fill={(colorForRoomName(layer.name) ?? layer.color ?? "rgba(210,210,210,ALPHA)").replace("ALPHA", "0.16")} className="stroke-border" strokeWidth={Math.max(width, height) * 0.001} />)}
            <g className="stroke-foreground" fill="none" strokeWidth={Math.max(width, height) * 0.002}>
              {lines.map((line, index) => <line key={index} x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} />)}
            </g>
            {furniture.map((item) => {
              const selected = selectedId === item.id;
              const handle = Math.max(width, height) * 0.014;
              return (
                <g key={item.id} transform={`rotate(${item.rotation} ${item.x} ${item.y})`} onPointerDown={(event) => {
                  event.stopPropagation();
                  setSelectedId(item.id);
                  const point = clientToSvg(event.clientX, event.clientY);
                  gestureRef.current = { kind: "move", furnitureId: item.id, start: point, initial: { ...item } };
                }}>
                  <image href={item.imageUrl} x={item.x - item.width / 2} y={item.y - item.height / 2} width={item.width} height={item.height} preserveAspectRatio="none" />
                  {selected ? <>
                    <rect x={item.x - item.width / 2} y={item.y - item.height / 2} width={item.width} height={item.height} fill="none" className="stroke-ember" strokeWidth={handle * 0.13} strokeDasharray={`${handle * 0.45} ${handle * 0.3}`} />
                    <g transform={`translate(${item.x + item.width / 2} ${item.y - item.height / 2})`} onPointerDown={(event) => {
                      event.stopPropagation();
                      const point = clientToSvg(event.clientX, event.clientY);
                      gestureRef.current = { kind: "rotate", furnitureId: item.id, start: point, initial: { ...item } };
                    }}>
                      <circle r={handle} className="fill-ember stroke-background" strokeWidth={handle * 0.12} />
                      <RotateCw x={-handle * 0.55} y={-handle * 0.55} width={handle * 1.1} height={handle * 1.1} className="text-primary-foreground" />
                    </g>
                    <rect x={item.x + item.width / 2 - handle} y={item.y + item.height / 2 - handle} width={handle * 2} height={handle * 2} rx={handle * 0.2} className="fill-ember stroke-background" strokeWidth={handle * 0.12} onPointerDown={(event) => {
                      event.stopPropagation();
                      const point = clientToSvg(event.clientX, event.clientY);
                      gestureRef.current = { kind: "scale", furnitureId: item.id, start: point, initial: { ...item } };
                    }} />
                  </> : null}
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="border-t border-border/60 bg-surface/40 p-4 lg:border-l lg:border-t-0">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold">Furniture</h3>
            {selectedId ? <Button size="icon" variant="ghost" title="Hapus furniture" onClick={() => { onFurnitureChange(furniture.filter((item) => item.id !== selectedId)); setSelectedId(null); }}><Trash2 className="h-4 w-4" /></Button> : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {FURNITURE_CATALOG.map((item) => <Button key={item.id} type="button" variant="outline" className="h-auto flex-col gap-1 rounded-none p-2" onClick={() => addFurniture(item)}>
              <img src={item.imageUrl} alt="" className="h-16 w-full object-contain" draggable={false} />
              <span className="mt-1 block truncate text-center text-[11px] font-medium">{item.name}</span>
            </Button>)}
          </div>
          <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importImage(file); event.currentTarget.value = ""; }} />
          <Button variant="outline" className="mt-3 w-full" onClick={() => uploadRef.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />Impor gambar</Button>
          {selectedId ? <div className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">Rotasi {furniture.find((item) => item.id === selectedId)?.rotation ?? 0}° · snap 5°</div> : null}
        </aside>
      </div>
    </section>
  );
}