import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { Plus, Trash2, Sparkles, Cable, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ClusterNode = {
  id: string;
  levelId: string;
  name: string;
  areaM2: number;
};
export type ClusterLink = { source: string; target: string };

export type ClusterGraph = {
  nodes: ClusterNode[];
  links: ClusterLink[];
};

export type GeneratedRoom = {
  nodeId: string;
  levelId: string;
  name: string;
  areaM2: number;
  // Position of rectangle center (px in world coords) and side (px)
  cx: number;
  cy: number;
  side: number;
};

export type GenerateResult = {
  rooms: GeneratedRoom[];
  links: ClusterLink[];
};

type LevelLite = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  levels: LevelLite[];
  graph: ClusterGraph;
  onSave: (g: ClusterGraph) => void;
  pxPerMeter: number;
  /** Maximum area per level (m²) — exceeding marks total red. Optional. */
  kdbLimitM2?: number;
  /** Maximum aggregate area across all levels (m²). Optional. */
  klbLimitM2?: number;
  onGenerate: (result: GenerateResult) => void;
};

type SimNode = SimulationNodeDatum & ClusterNode & { side: number };

function uid() {
  return `N${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function ClusterGeneratorDialog({
  open,
  onOpenChange,
  levels,
  graph,
  onSave,
  pxPerMeter,
  kdbLimitM2,
  klbLimitM2,
  onGenerate,
}: Props) {
  const [nodes, setNodes] = useState<ClusterNode[]>(graph.nodes);
  const [links, setLinks] = useState<ClusterLink[]>(graph.links);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  // Visual positions for nodes in the node editor (px, dialog-local coordinates)
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [, forceRender] = useState(0);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Re-sync when re-opened with new graph
  useEffect(() => {
    if (open) {
      setNodes(graph.nodes);
      setLinks(graph.links);
      setLinkMode(false);
      setLinkFrom(null);
      // initialize positions for new nodes
      const m = posRef.current;
      graph.nodes.forEach((n, i) => {
        if (!m.has(n.id)) {
          const col = i % 5;
          const row = Math.floor(i / 5);
          m.set(n.id, { x: 80 + col * 140, y: 80 + row * 110 });
        }
      });
    }
  }, [open, graph]);

  const totalsByLevel = useMemo(() => {
    const m = new Map<string, number>();
    nodes.forEach((n) => m.set(n.levelId, (m.get(n.levelId) ?? 0) + (Number(n.areaM2) || 0)));
    return m;
  }, [nodes]);
  const grandTotal = useMemo(
    () => nodes.reduce((s, n) => s + (Number(n.areaM2) || 0), 0),
    [nodes],
  );

  const addNode = (levelId?: string) => {
    const lvl = levelId ?? levels[0]?.id ?? "";
    const newN: ClusterNode = { id: uid(), levelId: lvl, name: `Ruang ${nodes.length + 1}`, areaM2: 12 };
    setNodes((prev) => [...prev, newN]);
    posRef.current.set(newN.id, { x: 100 + Math.random() * 300, y: 100 + Math.random() * 200 });
  };
  const removeNode = (id: string) => {
    setNodes((p) => p.filter((n) => n.id !== id));
    setLinks((p) => p.filter((l) => l.source !== id && l.target !== id));
    posRef.current.delete(id);
  };
  const updateNode = (id: string, patch: Partial<ClusterNode>) => {
    setNodes((p) => p.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  };
  const toggleLink = (a: string, b: string) => {
    if (a === b) return;
    setLinks((prev) => {
      const exists = prev.some(
        (l) => (l.source === a && l.target === b) || (l.source === b && l.target === a),
      );
      return exists
        ? prev.filter((l) => !((l.source === a && l.target === b) || (l.source === b && l.target === a)))
        : [...prev, { source: a, target: b }];
    });
  };

  const handleNodeClick = (id: string) => {
    if (!linkMode) return;
    if (linkFrom === null) setLinkFrom(id);
    else {
      toggleLink(linkFrom, id);
      setLinkFrom(null);
    }
  };

  const handleSaveClose = () => {
    onSave({ nodes, links });
    onOpenChange(false);
  };

  const handleGenerate = () => {
    if (nodes.length === 0) return;
    onSave({ nodes, links });

    // Build sim nodes (side in px from sqrt(area_m2) * pxPerMeter)
    const sim: SimNode[] = nodes.map((n) => {
      const side = Math.max(8, Math.sqrt(Math.max(0.5, n.areaM2)) * pxPerMeter);
      return { ...n, side, x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200 };
    });
    const byId = new Map(sim.map((n) => [n.id, n]));
    const simLinks: SimulationLinkDatum<SimNode>[] = links
      .filter((l) => byId.has(l.source) && byId.has(l.target))
      .map((l) => ({ source: l.source, target: l.target }));

    // Custom rectangle collision (axis-aligned, equal-side squares).
    function rectCollide() {
      const padding = 6;
      return function () {
        for (let i = 0; i < sim.length; i++) {
          for (let j = i + 1; j < sim.length; j++) {
            const a = sim[i];
            const b = sim[j];
            const minDx = (a.side + b.side) / 2 + padding;
            const minDy = (a.side + b.side) / 2 + padding;
            const dx = (b.x ?? 0) - (a.x ?? 0);
            const dy = (b.y ?? 0) - (a.y ?? 0);
            const ox = minDx - Math.abs(dx);
            const oy = minDy - Math.abs(dy);
            if (ox > 0 && oy > 0) {
              // resolve along the smaller overlap axis
              if (ox < oy) {
                const sgn = dx < 0 ? -1 : 1;
                a.x = (a.x ?? 0) - (sgn * ox) / 2;
                b.x = (b.x ?? 0) + (sgn * ox) / 2;
              } else {
                const sgn = dy < 0 ? -1 : 1;
                a.y = (a.y ?? 0) - (sgn * oy) / 2;
                b.y = (b.y ?? 0) + (sgn * oy) / 2;
              }
            }
          }
        }
      };
    }

    const simulation: Simulation<SimNode, SimulationLinkDatum<SimNode>> = forceSimulation(sim)
      .force(
        "link",
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
          .id((d) => d.id)
          .distance((l) => {
            const s = l.source as SimNode;
            const t = l.target as SimNode;
            return (s.side + t.side) / 2 + 24;
          })
          .strength(0.6),
      )
      .force("charge", forceManyBody().strength(-180))
      .force("center", forceCenter(0, 0))
      .force("rect", rectCollide())
      .stop();

    for (let i = 0; i < 400; i++) simulation.tick();

    // Group rooms by level and offset each cluster horizontally so levels don't overlap in staging
    const byLevel = new Map<string, SimNode[]>();
    sim.forEach((n) => {
      if (!byLevel.has(n.levelId)) byLevel.set(n.levelId, []);
      byLevel.get(n.levelId)!.push(n);
    });

    const rooms: GeneratedRoom[] = [];
    let offsetX = 0;
    for (const [, group] of byLevel) {
      const xs = group.map((n) => n.x ?? 0);
      const ys = group.map((n) => n.y ?? 0);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      // normalize: shift group origin to staging slot
      for (const n of group) {
        rooms.push({
          nodeId: n.id,
          levelId: n.levelId,
          name: n.name,
          areaM2: n.areaM2,
          cx: (n.x ?? 0) - minX + offsetX,
          cy: (n.y ?? 0) - minY,
          side: n.side,
        });
      }
      offsetX += maxX - minX + 200;
      void ys;
    }

    onGenerate({ rooms, links });
    onOpenChange(false);
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - dragRef.current.dx;
    const y = e.clientY - rect.top - dragRef.current.dy;
    posRef.current.set(dragRef.current.id, { x, y });
    forceRender((n) => n + 1);
  };
  const onSvgPointerUp = () => {
    dragRef.current = null;
  };

  const klbWarn = klbLimitM2 != null && klbLimitM2 > 0 && grandTotal > klbLimitM2 + 1e-3;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onSave({ nodes, links }); onOpenChange(v); }}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Cable className="h-4 w-4" /> Node Editor — Cluster Generator
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* LEFT: Node graph canvas */}
          <div className="flex-1 min-w-0 flex flex-col border-r">
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
              <Button size="sm" variant="outline" onClick={() => addNode()}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Tambah Node
              </Button>
              <Button
                size="sm"
                variant={linkMode ? "default" : "outline"}
                onClick={() => { setLinkMode((v) => !v); setLinkFrom(null); }}
                title="Aktifkan mode tautan, lalu klik 2 node untuk menghubungkan."
              >
                <Cable className="h-3.5 w-3.5 mr-1" /> {linkMode ? "Mode Tautan ON" : "Tautan"}
              </Button>
              <div className="text-[11px] text-muted-foreground ml-auto">
                Seret node untuk mengatur posisi · {nodes.length} node · {links.length} tautan
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-[radial-gradient(circle,#e5e5e5_1px,transparent_1px)] [background-size:16px_16px]">
              <svg
                ref={svgRef}
                width="100%"
                height="100%"
                className="min-h-[400px]"
                onPointerMove={onSvgPointerMove}
                onPointerUp={onSvgPointerUp}
                onPointerLeave={onSvgPointerUp}
              >
                {/* links */}
                {links.map((l, i) => {
                  const a = posRef.current.get(l.source);
                  const b = posRef.current.get(l.target);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#e85d3a"
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      opacity={0.75}
                    />
                  );
                })}
                {/* nodes */}
                {nodes.map((n) => {
                  const p = posRef.current.get(n.id) ?? { x: 100, y: 100 };
                  const selected = linkFrom === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x},${p.y})`}
                      style={{ cursor: linkMode ? "pointer" : "grab" }}
                      onPointerDown={(e) => {
                        if (linkMode) return;
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                        const rect = svgRef.current!.getBoundingClientRect();
                        dragRef.current = {
                          id: n.id,
                          dx: e.clientX - rect.left - p.x,
                          dy: e.clientY - rect.top - p.y,
                        };
                      }}
                      onClick={() => handleNodeClick(n.id)}
                    >
                      <rect
                        x={-55}
                        y={-22}
                        width={110}
                        height={44}
                        rx={6}
                        fill="#fff"
                        stroke={selected ? "#e85d3a" : "#1a1a1a"}
                        strokeWidth={selected ? 2.5 : 1.5}
                      />
                      <text x={0} y={-4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#1a1a1a">
                        {n.name.length > 16 ? n.name.slice(0, 15) + "…" : n.name}
                      </text>
                      <text x={0} y={12} textAnchor="middle" fontSize={10} fill="#666">
                        {n.areaM2} m² · {levels.find((l) => l.id === n.levelId)?.name ?? "—"}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* RIGHT: Property table + totals */}
          <div className="w-[380px] flex flex-col">
            <div className="px-3 py-2 border-b bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              Properti Node
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1.5">
              {nodes.length === 0 && (
                <div className="text-xs text-muted-foreground p-4 text-center">
                  Belum ada node. Klik "Tambah Node".
                </div>
              )}
              {nodes.map((n) => (
                <div key={n.id} className="rounded border border-border/60 p-2 bg-background space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Input
                      className="h-7 text-xs"
                      value={n.name}
                      onChange={(e) => updateNode(n.id, { name: e.target.value })}
                      placeholder="Nama ruang"
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeNode(n.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      className="h-7 flex-1 rounded border border-input bg-background px-1.5 text-xs"
                      value={n.levelId}
                      onChange={(e) => updateNode(n.id, { levelId: e.target.value })}
                    >
                      {levels.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        inputMode="decimal"
                        className="h-7 w-20 text-xs"
                        value={n.areaM2}
                        onChange={(e) => updateNode(n.id, { areaM2: Math.max(0, Number(e.target.value) || 0) })}
                      />
                      <span className="text-[10px] text-muted-foreground">m²</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="border-t p-3 space-y-1.5 bg-muted/20 text-xs">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Luas Total per Level
              </Label>
              {levels.map((l) => {
                const total = totalsByLevel.get(l.id) ?? 0;
                const over = kdbLimitM2 != null && kdbLimitM2 > 0 && total > kdbLimitM2 + 1e-3;
                return (
                  <div key={l.id} className="flex justify-between items-baseline">
                    <span className="text-muted-foreground">{l.name}</span>
                    <span className={cn("font-display font-semibold tabular-nums", over && "text-red-500")}>
                      {total.toFixed(2)} <span className="text-[10px] text-muted-foreground">m²</span>
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-between items-baseline pt-1.5 border-t mt-1">
                <span className="text-muted-foreground">Total KLB</span>
                <span className={cn("font-display font-semibold tabular-nums", klbWarn && "text-red-500")}>
                  {grandTotal.toFixed(2)} <span className="text-[10px] text-muted-foreground">m²</span>
                </span>
              </div>
              {kdbLimitM2 != null && kdbLimitM2 > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  Batas KDB / level: {kdbLimitM2.toFixed(2)} m²
                </div>
              )}
              {klbLimitM2 != null && klbLimitM2 > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  Batas KLB total: {klbLimitM2.toFixed(2)} m²
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-muted/20">
          <Button variant="ghost" onClick={() => { onSave({ nodes, links }); onOpenChange(false); }}>
            <X className="h-4 w-4 mr-1" /> Tutup
          </Button>
          <Button variant="outline" onClick={handleSaveClose}>
            Simpan
          </Button>
          <Button onClick={handleGenerate} className="bg-gradient-ember text-white">
            <Sparkles className="h-4 w-4 mr-1" /> Generate Clustered Polygons
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
