import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Sparkles,
  Loader2,
  Play,
  Image as ImageIcon,
  Wand2,
  Layers,
  Download,
  RefreshCcw,
  CheckCircle2,
  Send,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/lib/auth";
import { generateRender } from "@/lib/render.functions";
import { useStudioStore, type RenderAngle } from "@/store/studio-store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/studio")({
  component: StudioPage,
});

// ---------- Sketch & screenshot loaders ----------
type SketchLite = { id: string; title: string };
type Shot = { id: string; dataUrl: string; ts: number };

function loadSketches(): SketchLite[] {
  try {
    const raw = localStorage.getItem("dabidabis_sketch_v2");
    if (!raw) return [];
    const s = JSON.parse(raw) as { sketches?: { id: string; title: string }[] };
    return (s.sketches ?? []).map((x) => ({ id: x.id, title: x.title }));
  } catch {
    return [];
  }
}
function loadShots(sketchId: string): Shot[] {
  try {
    const raw = localStorage.getItem(`dabidabis_model3d_shots_${sketchId}`);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// ---------- Angles ----------
const DEFAULT_ANGLES = ["Eye Level", "Bird's Eye", "Worm's Eye"];
const ANGLE_PROMPT: Record<string, string> = {
  "Eye Level": "sudut pandang eye level (setinggi mata pejalan kaki), komposisi frontal seimbang",
  "Bird's Eye": "sudut pandang bird's eye / aksonometrik tinggi, komposisi diagonal dinamis",
  "Worm's Eye": "sudut pandang worm's eye / low angle mendongak, kesan monumental",
};

// ---------- Node data types ----------
type UploadedShot = { id: string; dataUrl: string; name?: string };
type InputNodeData = {
  kind: "input";
  sketchId: string;
  sketchTitle: string;
  selectedShotId: string | null;
  uploads: UploadedShot[];
};
type PromptNodeData = {
  kind: "prompt";
  style: string;
  detail: string;
  geometryConsistency: number; // 0-100, konsistensi bentuk terhadap referensi sketsa
};
type RenderNodeData = {
  kind: "render";
  status: "idle" | "processing" | "done" | "error";
  progress: number;
  error?: string;
};
type OutputNodeData = {
  kind: "output";
  sketchId: string;
  sketchTitle: string;
  geometryConsistency: number; // 0-100, konsistensi geometry saat berubah angle
};

// Stable empty-array reference so zustand selectors don't return a new array
// every render (which triggers "getSnapshot should be cached" + infinite loop).
const EMPTY_OUTPUTS: RenderAngle[] = [];

// ---------- Nodes ----------
function NodeShell({
  title,
  icon,
  tone,
  children,
  hasTarget,
  hasSource,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "input" | "prompt" | "render" | "output";
  children: React.ReactNode;
  hasTarget?: boolean;
  hasSource?: boolean;
}) {
  const toneMap = {
    input: "border-sky-500/40 bg-sky-500/5",
    prompt: "border-violet-500/40 bg-violet-500/5",
    render: "border-amber-500/40 bg-amber-500/5",
    output: "border-emerald-500/40 bg-emerald-500/5",
  } as const;
  return (
    <div
      className={cn(
        "relative w-[280px] rounded-xl border bg-background/95 shadow-lg backdrop-blur",
        toneMap[tone],
      )}
      style={{ overflow: "visible" }}
    >
      {hasTarget && (
        <Handle
          id="in"
          type="target"
          position={Position.Left}
          isConnectable
          className="!h-4 !w-4 !bg-ember !border-2 !border-background !cursor-crosshair"
          style={{ left: -8, zIndex: 20 }}
        />
      )}
      {hasSource && (
        <Handle
          id="out"
          type="source"
          position={Position.Right}
          isConnectable
          className="!h-4 !w-4 !bg-ember !border-2 !border-background !cursor-crosshair"
          style={{ right: -8, zIndex: 20 }}
        />
      )}
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function InputNode({ id, data }: NodeProps) {
  const d = data as InputNodeData;
  const updateNode = useStudioStore((s) => s.updateNode);
  const [shots, setShots] = useState<Shot[]>(() => loadShots(d.sketchId));
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => setShots(loadShots(d.sketchId));
  const uploads = d.uploads ?? [];
  const merged: { id: string; dataUrl: string; source: "3d" | "upload" }[] = [
    ...shots.map((s) => ({ id: s.id, dataUrl: s.dataUrl, source: "3d" as const })),
    ...uploads.map((u) => ({ id: u.id, dataUrl: u.dataUrl, source: "upload" as const })),
  ];

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const readers = Array.from(files).map(
      (f) =>
        new Promise<UploadedShot>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () =>
            resolve({ id: crypto.randomUUID(), dataUrl: fr.result as string, name: f.name });
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(f);
        }),
    );
    try {
      const newOnes = await Promise.all(readers);
      updateNode(id, { uploads: [...uploads, ...newOnes] });
    } catch {
      toast.error("Gagal membaca file");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeUpload = (uid: string) => {
    updateNode(id, {
      uploads: uploads.filter((u) => u.id !== uid),
      selectedShotId: d.selectedShotId === uid ? null : d.selectedShotId,
    });
  };

  return (
    <NodeShell
      title={`3D Input · ${d.sketchTitle}`}
      icon={<ImageIcon className="h-3.5 w-3.5 text-sky-500" />}
      tone="input"
      hasSource
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {shots.length} dari 3D · {uploads.length} unggahan
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={refresh}
              className="rounded p-1 hover:bg-muted"
              title="Muat ulang screenshot 3D"
            >
              <RefreshCcw className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 hover:bg-sky-500/25"
              title="Unggah gambar eksternal"
            >
              <Upload className="h-3 w-3" /> Unggah
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
          </div>
        </div>
        {merged.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Belum ada gambar. Ambil screenshot di halaman 3D atau klik{" "}
            <span className="font-medium">Unggah</span> untuk pakai gambar eksternal.
          </p>
        ) : (
          <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
            {merged.map((s) => (
              <div key={s.id} className="relative">
                <button
                  type="button"
                  onClick={() => updateNode(id, { selectedShotId: s.id })}
                  className={cn(
                    "block w-full overflow-hidden rounded border-2 transition",
                    d.selectedShotId === s.id
                      ? "border-ember ring-1 ring-ember/50"
                      : "border-transparent hover:border-border",
                  )}
                >
                  <img src={s.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                </button>
                <span
                  className={cn(
                    "pointer-events-none absolute left-0 top-0 rounded-br px-1 text-[8px] font-medium text-white",
                    s.source === "3d" ? "bg-sky-500/80" : "bg-emerald-500/80",
                  )}
                >
                  {s.source === "3d" ? "3D" : "UP"}
                </span>
                {s.source === "upload" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeUpload(s.id);
                    }}
                    className="absolute right-0 top-0 rounded-bl bg-black/60 px-1 text-[8px] text-white opacity-0 transition hover:bg-red-500/80 group-hover:opacity-100"
                    title="Hapus"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </NodeShell>
  );
}

function PromptNode({ id, data }: NodeProps) {
  const d = data as PromptNodeData;
  const updateNode = useStudioStore((s) => s.updateNode);
  const presets = [
    "bare finish concrete",
    "cinematic lighting golden hour",
    "moody dusk, warm interior glow",
    "tropical modern, lush vegetation",
    "brutalist, dramatic shadows",
  ];
  return (
    <NodeShell
      title="Prompt & Style"
      icon={<Wand2 className="h-3.5 w-3.5 text-violet-500" />}
      tone="prompt"
      hasTarget
      hasSource
    >
      <div className="space-y-2">
        <div>
          <Label className="text-[10px]">Gaya arsitektur</Label>
          <input
            value={d.style}
            onChange={(e) => updateNode(id, { style: e.target.value })}
            placeholder="mis. bare finish concrete"
            className="mt-1 w-full rounded border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:border-ember"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => updateNode(id, { style: p })}
              className="rounded-full border border-border/60 px-1.5 py-0.5 text-[9px] hover:border-ember"
            >
              {p}
            </button>
          ))}
        </div>
        <div>
          <Label className="text-[10px]">Detail tambahan</Label>
          <Textarea
            value={d.detail}
            onChange={(e) => updateNode(id, { detail: e.target.value })}
            rows={3}
            placeholder="Konteks vegetasi, cuaca, aktivitas..."
            className="mt-1 resize-none text-xs"
          />
        </div>
      </div>
    </NodeShell>
  );
}

function RenderNode({
  id,
  data,
}: NodeProps) {
  const d = data as RenderNodeData;
  const trigger = useStudioExecute();
  return (
    <NodeShell
      title="AI Render Engine"
      icon={<Sparkles className="h-3.5 w-3.5 text-amber-500" />}
      tone="render"
      hasTarget
      hasSource
    >
      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground">
          Memroses melalui Lovable AI (Gemini image). Multi-angle otomatis 3 variasi.
        </p>
        <Button
          size="sm"
          onClick={() => trigger(id)}
          disabled={d.status === "processing"}
          className="w-full bg-gradient-primary text-xs shadow-primary"
        >
          {d.status === "processing" ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Merender…
            </>
          ) : (
            <>
              <Play className="mr-1 h-3 w-3" />
              Execute Render
            </>
          )}
        </Button>
        {d.status === "error" && (
          <p className="text-[10px] text-destructive">{d.error ?? "Render gagal."}</p>
        )}
        {d.status === "done" && (
          <p className="flex items-center gap-1 text-[10px] text-emerald-500">
            <CheckCircle2 className="h-3 w-3" /> Selesai
          </p>
        )}
      </div>
    </NodeShell>
  );
}

function OutputNode({ data }: NodeProps) {
  const d = data as OutputNodeData;
  const outputs = useStudioStore((s) => s.graph.outputs[d.sketchId]) ?? EMPTY_OUTPUTS;
  const sync = useStudioStore((s) => s.syncToPresentasi);
  const total = outputs.length || 3;
  const done = outputs.filter((o) => o.status === "done").length;
  const avgProgress = outputs.length
    ? Math.round(outputs.reduce((s, o) => s + o.progress, 0) / outputs.length)
    : 0;
  const anyProcessing = outputs.some((o) => o.status === "processing");

  return (
    <NodeShell
      title={`Multi-Angle Output · ${d.sketchTitle}`}
      icon={<Layers className="h-3.5 w-3.5 text-emerald-500" />}
      tone="output"
      hasTarget
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{done}/{total} angle</span>
          <span>{avgProgress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-gradient-primary transition-all duration-300"
            style={{ width: `${avgProgress}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(outputs.length ? outputs : DEFAULT_ANGLES.map((a, i) => ({
            id: `ph-${i}`, angle: a, image: null, status: "idle" as const, progress: 0,
          }))).map((o) => (
            <div
              key={o.id}
              className="relative aspect-[4/3] overflow-hidden rounded border border-border/60 bg-background"
            >
              {o.image ? (
                <img src={o.image} alt={o.angle} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  {o.status === "processing" ? (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  ) : (
                    <ImageIcon className="h-3 w-3 text-muted-foreground/40" />
                  )}
                </div>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[8px] text-white">
                {o.angle}
              </span>
              {o.image && (
                <a
                  href={o.image}
                  download={`${d.sketchTitle}-${o.angle}.png`}
                  className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white opacity-0 hover:opacity-100"
                >
                  <Download className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={anyProcessing || done === 0}
          onClick={() => {
            sync(d.sketchId, d.sketchTitle);
            toast.success("Tersinkron ke slide Perspektif Presentasi");
          }}
          className="w-full text-xs"
        >
          <Send className="mr-1 h-3 w-3" />
          Kirim ke Presentasi
        </Button>
      </div>
    </NodeShell>
  );
}

const nodeTypes = {
  input: InputNode,
  prompt: PromptNode,
  render: RenderNode,
  output: OutputNode,
};

// ---------- Execute hook ----------
function useStudioExecute() {
  const graph = useStudioStore((s) => s.graph);
  const updateNode = useStudioStore((s) => s.updateNode);
  const setOutputs = useStudioStore((s) => s.setOutputs);
  const updateOutput = useStudioStore((s) => s.updateOutput);
  const syncToPresentasi = useStudioStore((s) => s.syncToPresentasi);
  const callRender = useServerFn(generateRender);

  return useCallback(
    async (renderNodeId: string) => {
      // Trace graph: input -> prompt -> renderNodeId -> output.
      const inEdges = (target: string) => graph.edges.filter((e) => e.target === target);
      const outEdges = (source: string) => graph.edges.filter((e) => e.source === source);

      const promptEdge = inEdges(renderNodeId)[0];
      if (!promptEdge) return toast.error("Sambungkan Prompt ke Render Engine");
      const promptNode = graph.nodes.find((n) => n.id === promptEdge.source);
      const inputEdge = promptNode ? inEdges(promptNode.id)[0] : null;
      const inputNode = inputEdge ? graph.nodes.find((n) => n.id === inputEdge.source) : null;
      const outputEdge = outEdges(renderNodeId)[0];
      const outputNode = outputEdge ? graph.nodes.find((n) => n.id === outputEdge.target) : null;

      if (!inputNode || !promptNode || !outputNode) {
        return toast.error("Rangkaian node belum lengkap");
      }
      const inData = inputNode.data as InputNodeData;
      const prData = promptNode.data as PromptNodeData;
      const outData = outputNode.data as OutputNodeData;

      const shots = loadShots(inData.sketchId);
      const uploads = inData.uploads ?? [];
      const pool: { id: string; dataUrl: string }[] = [
        ...shots.map((s) => ({ id: s.id, dataUrl: s.dataUrl })),
        ...uploads.map((u) => ({ id: u.id, dataUrl: u.dataUrl })),
      ];
      const chosen =
        pool.find((s) => s.id === inData.selectedShotId) ?? pool[0];
      if (!chosen) return toast.error(`Pilih atau unggah gambar untuk ${inData.sketchTitle}`);

      const finalPrompt = [prData.style, prData.detail, "arsitektur fotorealistis, kualitas tinggi"]
        .filter(Boolean)
        .join(", ");
      if (!finalPrompt.trim()) return toast.error("Isi gaya atau detail prompt");

      // Init outputs (3 angles)
      const angles: RenderAngle[] = DEFAULT_ANGLES.map((a) => ({
        id: crypto.randomUUID(),
        angle: a,
        image: null,
        status: "processing",
        progress: 5,
      }));
      setOutputs(outData.sketchId, angles);
      updateNode(renderNodeId, { status: "processing", progress: 0, error: undefined });

      // Simulated smooth progress per angle (keeps UI lively during async waits)
      const timers: Record<string, ReturnType<typeof setInterval>> = {};
      for (const a of angles) {
        timers[a.id] = setInterval(() => {
          const cur = useStudioStore.getState().graph.outputs[outData.sketchId]?.find(
            (o) => o.id === a.id,
          );
          if (!cur || cur.status !== "processing") return;
          const next = Math.min(cur.progress + 3 + Math.random() * 4, 90);
          updateOutput(outData.sketchId, a.id, { progress: next });
        }, 400);
      }

      try {
        // Kick off in parallel, but yield to UI between starts so canvas stays smooth.
        const results = await Promise.all(
          angles.map(async (a) => {
            const anglePrompt = `${finalPrompt}. ${ANGLE_PROMPT[a.angle] ?? a.angle}`;
            try {
              const res = await callRender({
                data: {
                  sketchBase64: chosen.dataUrl,
                  referenceBase64: null,
                  prompt: anglePrompt,
                  renderType: "exterior",
                  accuracy: 8,
                  consistency: 6,
                },
              });
              clearInterval(timers[a.id]);
              if (res.ok && res.resultUrl) {
                // Fetch and encode as data URL so it persists offline.
                let dataUrl: string | null = null;
                try {
                  const r = await fetch(res.resultUrl);
                  const blob = await r.blob();
                  dataUrl = await new Promise<string>((resolve, reject) => {
                    const fr = new FileReader();
                    fr.onload = () => resolve(fr.result as string);
                    fr.onerror = () => reject(fr.error);
                    fr.readAsDataURL(blob);
                  });
                } catch {
                  dataUrl = res.resultUrl;
                }
                updateOutput(outData.sketchId, a.id, {
                  image: dataUrl,
                  status: "done",
                  progress: 100,
                });
                return true;
              }
              updateOutput(outData.sketchId, a.id, {
                status: "error",
                progress: 100,
                error: res.ok ? "Tidak ada URL" : res.error,
              });
              return false;
            } catch (e) {
              clearInterval(timers[a.id]);
              updateOutput(outData.sketchId, a.id, {
                status: "error",
                progress: 100,
                error: e instanceof Error ? e.message : "Error",
              });
              return false;
            }
          }),
        );

        const success = results.filter(Boolean).length;
        updateNode(renderNodeId, {
          status: success === angles.length ? "done" : success > 0 ? "done" : "error",
          progress: 100,
          error: success === 0 ? "Semua angle gagal" : undefined,
        });
        if (success > 0) {
          // Auto-sync ke Presentasi.
          syncToPresentasi(outData.sketchId, outData.sketchTitle);
          toast.success(`${success}/${angles.length} angle selesai · disinkron ke Presentasi`);
        } else {
          toast.error("Render gagal");
        }
      } finally {
        for (const k of Object.keys(timers)) clearInterval(timers[k]);
      }
    },
    [graph, callRender, setOutputs, updateNode, updateOutput, syncToPresentasi],
  );
}

// ---------- Preset builder ----------
function buildPreset(sketches: SketchLite[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const rowH = 340;
  sketches.forEach((sk, i) => {
    const y = i * rowH;
    const inputId = `input-${sk.id}`;
    const promptId = `prompt-${sk.id}`;
    const renderId = `render-${sk.id}`;
    const outputId = `output-${sk.id}`;
    nodes.push(
      {
        id: inputId,
        type: "input",
        position: { x: 0, y },
        data: {
          kind: "input",
          sketchId: sk.id,
          sketchTitle: sk.title,
          selectedShotId: null,
          uploads: [],
        } satisfies InputNodeData,
      },
      {
        id: promptId,
        type: "prompt",
        position: { x: 340, y },
        data: {
          kind: "prompt",
          style: "bare finish concrete, cinematic lighting",
          detail: "",
        } satisfies PromptNodeData,
      },
      {
        id: renderId,
        type: "render",
        position: { x: 680, y },
        data: { kind: "render", status: "idle", progress: 0 } satisfies RenderNodeData,
      },
      {
        id: outputId,
        type: "output",
        position: { x: 1020, y },
        data: {
          kind: "output",
          sketchId: sk.id,
          sketchTitle: sk.title,
        } satisfies OutputNodeData,
      },
    );
    const mkEdge = (source: string, target: string): Edge => ({
      id: `${source}->${target}`,
      source,
      target,
      animated: true,
      style: { stroke: "hsl(var(--ember, 24 95% 53%))", strokeWidth: 2 },
    });
    edges.push(
      mkEdge(inputId, promptId),
      mkEdge(promptId, renderId),
      mkEdge(renderId, outputId),
    );
  });
  return { nodes, edges };
}

// ---------- Page ----------
function StudioPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const hydrate = useStudioStore((s) => s.hydrate);
  const loaded = useStudioStore((s) => s.loaded);
  const graph = useStudioStore((s) => s.graph);
  const setNodesEdges = useStudioStore((s) => s.setNodesEdges);
  const setGraph = useStudioStore((s) => s.setGraph);

  const [sketches, setSketches] = useState<SketchLite[]>([]);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  useEffect(() => {
    hydrate();
    setSketches(loadSketches());
  }, [hydrate]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, graph.nodes);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => setNodesEdges(next, graph.edges), 200);
    },
    [graph, setNodesEdges],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, graph.edges);
      setNodesEdges(graph.nodes, next);
    },
    [graph, setNodesEdges],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      const next = addEdge(
        { ...c, animated: true, style: { stroke: "hsl(24 95% 53%)", strokeWidth: 2 } },
        graph.edges,
      );
      setNodesEdges(graph.nodes, next);
    },
    [graph, setNodesEdges],
  );

  const loadPreset = () => {
    const fresh = loadSketches();
    setSketches(fresh);
    if (fresh.length === 0) {
      toast.error("Belum ada sketsa. Buat sketsa di halaman Sketsa dahulu.");
      return;
    }
    const { nodes, edges } = buildPreset(fresh);
    setGraph({ nodes, edges, outputs: graph.outputs });
    toast.success(`Preset dimuat: ${fresh.length} sketsa`);
  };

  const clearAll = () => {
    setGraph({ nodes: [], edges: [], outputs: {} });
    toast.success("Kanvas dibersihkan");
  };

  const totalOutputs = useMemo(
    () =>
      Object.values(graph.outputs).reduce(
        (s, list) => s + list.filter((o) => o.image).length,
        0,
      ),
    [graph.outputs],
  );

  if (loading || !user || !loaded) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center justify-between border-b border-border/60 bg-surface/60 px-4 py-3 backdrop-blur sm:px-6">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Render Studio · Node Canvas
          </h1>
          <p className="text-xs text-muted-foreground">
            {sketches.length} sketsa · {graph.nodes.length} node · {totalOutputs} render selesai
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={clearAll} disabled={graph.nodes.length === 0}>
            Bersihkan
          </Button>
          <Button
            size="sm"
            onClick={loadPreset}
            className="bg-gradient-primary shadow-primary"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Load Default Render Preset
          </Button>
        </div>
      </div>

      <div className="relative flex-1">
        <ReactFlowProvider>
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ animated: true, style: { stroke: "hsl(24 95% 53%)", strokeWidth: 2 } }}
            connectionMode={"loose" as never}
            connectionRadius={40}
            nodesDraggable
            nodesConnectable
            elementsSelectable
          >
            <Background gap={24} color="hsl(var(--border))" />
            <Controls className="!bg-surface !border-border" />
            <MiniMap
              pannable
              zoomable
              className="!bg-surface !border-border"
              nodeColor={(n) => {
                switch (n.type) {
                  case "input": return "#0ea5e9";
                  case "prompt": return "#8b5cf6";
                  case "render": return "#f59e0b";
                  case "output": return "#10b981";
                  default: return "#888";
                }
              }}
            />
          </ReactFlow>
        </ReactFlowProvider>
        {graph.nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto max-w-md rounded-2xl border border-border/60 bg-surface/80 p-6 text-center shadow-soft backdrop-blur">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-ember" />
              <h2 className="font-display text-lg font-semibold">Kanvas Kosong</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Klik <span className="font-medium">Load Default Render Preset</span> untuk
                membuat rangkaian node per sketsa (Input → Prompt → Render → Output).
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
