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
  Palette,
  Pencil,
  Highlighter,
  Eraser,
  Plus,
  X,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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

function useSketchList(): SketchLite[] {
  const [list, setList] = useState<SketchLite[]>(() => loadSketches());
  useEffect(() => {
    const reload = () => setList(loadSketches());
    window.addEventListener("storage", reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("focus", reload);
    };
  }, []);
  return list;
}

function SketchSelector({
  sketches,
  value,
  onChange,
  tone,
}: {
  sketches: SketchLite[];
  value: string;
  onChange: (sk: SketchLite) => void;
  tone: "sky" | "emerald";
}) {
  const ringCls = tone === "sky" ? "focus:border-sky-500" : "focus:border-emerald-500";
  return (
    <select
      value={value}
      onChange={(e) => {
        const sk = sketches.find((s) => s.id === e.target.value);
        if (sk) onChange(sk);
      }}
      className={cn(
        "w-full rounded border border-border/60 bg-background px-2 py-1 text-[11px] font-medium outline-none",
        ringCls,
      )}
    >
      {sketches.length === 0 && <option value="">(Belum ada sketsa)</option>}
      {sketches.map((s) => (
        <option key={s.id} value={s.id}>
          {s.title}
        </option>
      ))}
      {sketches.length > 0 && !sketches.some((s) => s.id === value) && (
        <option value={value}>{value ? "(sketsa terhapus)" : ""}</option>
      )}
    </select>
  );
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
  geometryConsistency: number;
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
  geometryConsistency: number;
  // For "edit output" nodes we render a single image (not multi-angle)
  standalone?: boolean;
  standaloneImage?: string | null;
  standaloneStatus?: "idle" | "processing" | "done" | "error";
  standaloneProgress?: number;
  standaloneError?: string;
};
type ReferenceNodeData = {
  kind: "reference";
  image: string | null;
  label: string;
};
type EditNodeData = {
  kind: "edit";
  sketchId: string;
  sketchTitle: string;
  sourceImage: string;
  annotatedImage: string;
  colorPrompts: { color: string; label: string; prompt: string }[];
};

const EMPTY_OUTPUTS: RenderAngle[] = [];

// Color palette for annotation
const ANNOTATION_COLORS = [
  { color: "#ef4444", label: "Merah" },
  { color: "#f59e0b", label: "Oranye" },
  { color: "#eab308", label: "Kuning" },
  { color: "#22c55e", label: "Hijau" },
  { color: "#3b82f6", label: "Biru" },
  { color: "#a855f7", label: "Ungu" },
];

// ---------- Node shell ----------
function NodeShell({
  title,
  icon,
  tone,
  children,
  hasTarget,
  hasSource,
  extraSource,
  onRemove,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "input" | "prompt" | "render" | "output" | "reference" | "edit";
  children: React.ReactNode;
  hasTarget?: boolean;
  hasSource?: boolean;
  extraSource?: { id: string; topPct: number; color?: string; label?: string };
  onRemove?: () => void;
}) {
  const toneMap = {
    input: "border-sky-500/40 bg-sky-500/5",
    prompt: "border-violet-500/40 bg-violet-500/5",
    render: "border-amber-500/40 bg-amber-500/5",
    output: "border-emerald-500/40 bg-emerald-500/5",
    reference: "border-pink-500/40 bg-pink-500/5",
    edit: "border-cyan-500/40 bg-cyan-500/5",
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
      {extraSource && (
        <Handle
          id={extraSource.id}
          type="source"
          position={Position.Right}
          isConnectable
          className="!h-4 !w-4 !border-2 !border-background !cursor-crosshair"
          style={{
            right: -8,
            top: `${extraSource.topPct}%`,
            background: extraSource.color ?? "#ec4899",
            zIndex: 20,
          }}
          title={extraSource.label}
        />
      )}
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        {icon}
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide">{title}</span>
        {onRemove && (
          <button
            onClick={onRemove}
            className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Hapus node"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// ---------- Ephemeral annotation modal state (module-level for simplicity) ----------
type AnnotationTarget = {
  sketchId: string;
  sketchTitle: string;
  angleId: string;
  angleName: string;
  image: string;
};

// ---------- Input Node ----------
function InputNode({ id, data }: NodeProps) {
  const d = data as InputNodeData;
  const updateNode = useStudioStore((s) => s.updateNode);
  const removeNode = useStudioStore((s) => s.removeNode);
  const sketches = useSketchList();
  const [shots, setShots] = useState<Shot[]>(() => loadShots(d.sketchId));
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setShots(loadShots(d.sketchId));
  }, [d.sketchId]);

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

  return (
    <NodeShell
      title="3D Input"
      icon={<ImageIcon className="h-3.5 w-3.5 text-sky-500" />}
      tone="input"
      hasSource
      onRemove={() => removeNode(id)}
    >
      <div className="space-y-2">
        <SketchSelector
          sketches={sketches}
          value={d.sketchId}
          tone="sky"
          onChange={(sk) => {
            updateNode(id, { sketchId: sk.id, sketchTitle: sk.title, selectedShotId: null });
            setShots(loadShots(sk.id));
          }}
        />
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
            Belum ada gambar. Ambil screenshot 3D atau klik <b>Unggah</b>.
          </p>
        ) : (
          <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
            {merged.map((s) => (
              <button
                key={s.id}
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
            ))}
          </div>
        )}
      </div>
    </NodeShell>
  );
}

// ---------- Prompt Node ----------
function PromptNode({ id, data }: NodeProps) {
  const d = data as PromptNodeData;
  const updateNode = useStudioStore((s) => s.updateNode);
  const removeNode = useStudioStore((s) => s.removeNode);
  const addNode = useStudioStore((s) => s.addNode);
  const addEdgeStore = useStudioStore((s) => s.addEdge);
  const nodes = useStudioStore((s) => s.graph.nodes);

  const presets = [
    "bare finish concrete",
    "cinematic lighting golden hour",
    "moody dusk, warm interior glow",
    "tropical modern, lush vegetation",
    "brutalist, dramatic shadows",
  ];

  const spawnReference = () => {
    const me = nodes.find((n) => n.id === id);
    const pos = me ? { x: me.position.x + 60, y: me.position.y + 360 } : { x: 200, y: 400 };
    const refId = `reference-${crypto.randomUUID().slice(0, 8)}`;
    addNode({
      id: refId,
      type: "reference",
      position: pos,
      data: { kind: "reference", image: null, label: "Referensi Style" } satisfies ReferenceNodeData,
    });
    // auto-connect reference → this prompt node (reference is a visual style
    // addition to the prompt; geometry still comes from Input node via prompt).
    addEdgeStore({
      id: `${refId}->${id}`,
      source: refId,
      target: id,
      animated: true,
      style: { stroke: "#ec4899", strokeWidth: 2 },
    });
    toast.success("Node Referensi Style tersambung ke Prompt");
  };

  return (
    <NodeShell
      title="Prompt & Style"
      icon={<Wand2 className="h-3.5 w-3.5 text-violet-500" />}
      tone="prompt"
      hasTarget
      hasSource
      onRemove={() => removeNode(id)}
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
        <div className="rounded border border-border/60 bg-background/60 p-2">
          <div className="flex items-center justify-between">
            <Label className="text-[10px]">Geometry Consistency</Label>
            <span className="text-[10px] font-medium text-ember">
              {d.geometryConsistency ?? 70}%
            </span>
          </div>
          <Slider
            value={[d.geometryConsistency ?? 70]}
            onValueChange={(v) => updateNode(id, { geometryConsistency: v[0] })}
            min={0}
            max={100}
            step={1}
            className="mt-2"
          />
          <p className="mt-1 text-[9px] leading-tight text-muted-foreground">
            0% bebas bentuk · 100% ikuti sketsa referensi persis
          </p>
        </div>
        <button
          type="button"
          onClick={spawnReference}
          className="flex w-full items-center justify-center gap-1 rounded border border-pink-500/40 bg-pink-500/10 px-2 py-1.5 text-[11px] font-medium text-pink-600 hover:bg-pink-500/20"
        >
          <Palette className="h-3 w-3" /> Unggah Referensi Style
        </button>
      </div>
    </NodeShell>
  );
}

// ---------- Reference Style Node ----------
function ReferenceNode({ id, data }: NodeProps) {
  const d = data as ReferenceNodeData;
  const updateNode = useStudioStore((s) => s.updateNode);
  const removeNode = useStudioStore((s) => s.removeNode);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleUpload = (files: FileList | null) => {
    if (!files || !files[0]) return;
    const fr = new FileReader();
    fr.onload = () => updateNode(id, { image: fr.result as string });
    fr.readAsDataURL(files[0]);
  };

  return (
    <NodeShell
      title="Referensi Style"
      icon={<Palette className="h-3.5 w-3.5 text-pink-500" />}
      tone="reference"
      hasSource
      onRemove={() => removeNode(id)}
    >
      <div className="space-y-2">
        <input
          value={d.label}
          onChange={(e) => updateNode(id, { label: e.target.value })}
          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:border-pink-500"
          placeholder="Nama referensi"
        />
        {d.image ? (
          <div className="relative overflow-hidden rounded border border-border/60">
            <img src={d.image} alt={d.label} className="w-full object-cover" />
            <button
              onClick={() => updateNode(id, { image: null })}
              className="absolute right-1 top-1 rounded bg-black/70 p-1 text-white hover:bg-red-500/80"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-pink-500/40 bg-pink-500/5 text-[11px] text-pink-600 hover:bg-pink-500/10"
          >
            <Upload className="h-4 w-4" />
            Klik unggah gambar referensi
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <p className="text-[9px] leading-tight text-muted-foreground">
          Hubungkan ke <b>AI Render Engine</b> untuk mengarahkan gaya visual.
        </p>
      </div>
    </NodeShell>
  );
}

// ---------- Render Node ----------
function RenderNode({ id, data }: NodeProps) {
  const d = data as RenderNodeData;
  const removeNode = useStudioStore((s) => s.removeNode);
  const trigger = useStudioExecute();
  return (
    <NodeShell
      title="AI Render Engine"
      icon={<Sparkles className="h-3.5 w-3.5 text-amber-500" />}
      tone="render"
      hasTarget
      hasSource
      onRemove={() => removeNode(id)}
    >
      <div className="space-y-2">
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

// ---------- Output Node ----------
function OutputNode({
  id,
  data,
  onAnnotate,
}: NodeProps & { onAnnotate?: (t: AnnotationTarget) => void }) {
  const d = data as OutputNodeData;
  const outputs = useStudioStore((s) => s.graph.outputs[d.sketchId]) ?? EMPTY_OUTPUTS;
  const sync = useStudioStore((s) => s.syncToPresentasi);
  const updateNode = useStudioStore((s) => s.updateNode);
  const removeNode = useStudioStore((s) => s.removeNode);

  // Standalone output (from edit node)
  if (d.standalone) {
    const status = d.standaloneStatus ?? "idle";
    return (
      <NodeShell
        title={`Output Perbaikan · ${d.sketchTitle}`}
        icon={<Layers className="h-3.5 w-3.5 text-emerald-500" />}
        tone="output"
        hasTarget
        onRemove={() => removeNode(id)}
      >
        <div className="space-y-2">
          <div className="relative aspect-[4/3] overflow-hidden rounded border border-border/60 bg-background">
            {d.standaloneImage ? (
              <img
                src={d.standaloneImage}
                alt="Hasil perbaikan"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                {status === "processing" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
                )}
              </div>
            )}
          </div>
          {status === "error" && (
            <p className="text-[10px] text-destructive">
              {d.standaloneError ?? "Render gagal."}
            </p>
          )}
          {d.standaloneImage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                try {
                  const raw = localStorage.getItem("dabidabis_perspektif_v1");
                  const store: Record<
                    string,
                    { id: string; title: string; image: string | null }[]
                  > = raw ? JSON.parse(raw) : {};
                  const items = store[d.sketchId] ?? [];
                  items.push({
                    id: `studio-edit-${id}`,
                    title: `${d.sketchTitle} · Perbaikan`,
                    image: d.standaloneImage!,
                  });
                  store[d.sketchId] = items;
                  localStorage.setItem("dabidabis_perspektif_v1", JSON.stringify(store));
                  toast.success("Terkirim ke Presentasi");
                } catch {
                  toast.error("Gagal menyimpan");
                }
              }}
              className="w-full text-xs"
            >
              <Send className="mr-1 h-3 w-3" /> Kirim ke Presentasi
            </Button>
          )}
        </div>
      </NodeShell>
    );
  }

  const total = outputs.length || 3;
  const done = outputs.filter((o) => o.status === "done").length;
  const avgProgress = outputs.length
    ? Math.round(outputs.reduce((s, o) => s + o.progress, 0) / outputs.length)
    : 0;
  const anyProcessing = outputs.some((o) => o.status === "processing");

  return (
    <NodeShell
      title="Multi-Angle Output"
      icon={<Layers className="h-3.5 w-3.5 text-emerald-500" />}
      tone="output"
      hasTarget
      onRemove={() => removeNode(id)}
    >
      <div className="space-y-2">
        <OutputSketchSelector id={id} sketchId={d.sketchId} />

        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {done}/{total} angle
          </span>
          <span>{avgProgress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-gradient-primary transition-all duration-300"
            style={{ width: `${avgProgress}%` }}
          />
        </div>
        <div className="rounded border border-border/60 bg-background/60 p-2">
          <div className="flex items-center justify-between">
            <Label className="text-[10px]">Geometry Consistency</Label>
            <span className="text-[10px] font-medium text-emerald-500">
              {d.geometryConsistency ?? 80}%
            </span>
          </div>
          <Slider
            value={[d.geometryConsistency ?? 80]}
            onValueChange={(v) => updateNode(id, { geometryConsistency: v[0] })}
            min={0}
            max={100}
            step={1}
            className="mt-2"
          />
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(outputs.length
            ? outputs
            : DEFAULT_ANGLES.map((a, i) => ({
                id: `ph-${i}`,
                angle: a,
                image: null,
                status: "idle" as const,
                progress: 0,
              }))
          ).map((o) => (
            <div
              key={o.id}
              className={cn(
                "group relative aspect-[4/3] overflow-hidden rounded border border-border/60 bg-background",
                o.image && "cursor-pointer hover:border-ember",
              )}
              onClick={() => {
                if (!o.image || !onAnnotate) return;
                onAnnotate({
                  sketchId: d.sketchId,
                  sketchTitle: d.sketchTitle,
                  angleId: o.id,
                  angleName: o.angle,
                  image: o.image,
                });
              }}
            >
              {o.image ? (
                <img
                  src={o.image}
                  alt={o.angle}
                  className="h-full w-full object-cover"
                />
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
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100"
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
          <Send className="mr-1 h-3 w-3" /> Kirim ke Presentasi
        </Button>
      </div>
    </NodeShell>
  );
}

// ---------- Edit Node (sketsa perbaikan) ----------
function EditNode({ id, data }: NodeProps) {
  const d = data as EditNodeData;
  const updateNode = useStudioStore((s) => s.updateNode);
  const removeNode = useStudioStore((s) => s.removeNode);

  return (
    <NodeShell
      title={`Sketsa Perbaikan · ${d.sketchTitle}`}
      icon={<Pencil className="h-3.5 w-3.5 text-cyan-500" />}
      tone="edit"
      hasSource
      onRemove={() => removeNode(id)}
    >
      <div className="space-y-2">
        <div className="overflow-hidden rounded border border-border/60">
          <img src={d.annotatedImage} alt="Anotasi" className="w-full object-cover" />
        </div>
        <p className="text-[10px] font-medium text-muted-foreground">
          Prompt per warna coretan:
        </p>
        <div className="space-y-1.5">
          {d.colorPrompts.map((cp, idx) => (
            <div key={idx} className="flex items-start gap-1.5">
              <div
                className="mt-1 h-3 w-3 shrink-0 rounded-full border border-border"
                style={{ background: cp.color }}
                title={cp.label}
              />
              <Textarea
                value={cp.prompt}
                onChange={(e) => {
                  const next = d.colorPrompts.map((c, i) =>
                    i === idx ? { ...c, prompt: e.target.value } : c,
                  );
                  updateNode(id, { colorPrompts: next });
                }}
                rows={2}
                placeholder={`Maksud coretan ${cp.label}…`}
                className="min-h-0 resize-none text-[11px] leading-tight"
              />
            </div>
          ))}
        </div>
        <p className="text-[9px] leading-tight text-muted-foreground">
          Hubungkan ke <b>AI Render Engine</b> untuk memproses perbaikan.
        </p>
      </div>
    </NodeShell>
  );
}

// ---------- Annotation Modal ----------
function AnnotationModal({
  target,
  onClose,
  onMakeNode,
}: {
  target: AnnotationTarget;
  onClose: () => void;
  onMakeNode: (annotatedDataUrl: string, usedColors: string[]) => void;
}) {
  const [color, setColor] = useState(ANNOTATION_COLORS[0].color);
  const [tool, setTool] = useState<"pen" | "highlighter" | "eraser">("pen");
  const [size, setSize] = useState(6);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const usedColors = useRef<Set<string>>(new Set());

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
    };
    img.src = target.image;
  }, [target.image]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    last.current = getPos(e);
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const p = getPos(e);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = size * 3;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
      ctx.globalAlpha = tool === "highlighter" ? 0.35 : 1;
      ctx.lineWidth = tool === "highlighter" ? size * 3 : size;
      usedColors.current.add(color);
    }
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    last.current = p;
  };
  const onUp = () => {
    drawing.current = false;
    last.current = null;
  };

  const clearCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    usedColors.current.clear();
  };

  const makeNode = () => {
    const img = imgRef.current;
    const overlay = canvasRef.current;
    if (!img || !overlay) return;
    const flat = document.createElement("canvas");
    flat.width = img.naturalWidth;
    flat.height = img.naturalHeight;
    const ctx = flat.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    ctx.drawImage(overlay, 0, 0);
    const dataUrl = flat.toDataURL("image/png");
    onMakeNode(dataUrl, Array.from(usedColors.current));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur">
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h3 className="font-display text-base font-semibold">
              Anotasi · {target.sketchTitle}
            </h3>
            <p className="text-xs text-muted-foreground">
              {target.angleName} — coret dengan warna untuk menandai perbaikan
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-surface/60 px-4 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTool("pen")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-xs",
                tool === "pen" ? "bg-ember/20 text-ember" : "hover:bg-muted",
              )}
            >
              <Pencil className="h-3.5 w-3.5" /> Pen
            </button>
            <button
              onClick={() => setTool("highlighter")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-xs",
                tool === "highlighter" ? "bg-ember/20 text-ember" : "hover:bg-muted",
              )}
            >
              <Highlighter className="h-3.5 w-3.5" /> Stabilo
            </button>
            <button
              onClick={() => setTool("eraser")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-xs",
                tool === "eraser" ? "bg-ember/20 text-ember" : "hover:bg-muted",
              )}
            >
              <Eraser className="h-3.5 w-3.5" /> Hapus
            </button>
          </div>
          <div className="mx-2 h-5 w-px bg-border" />
          <div className="flex items-center gap-1">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.color}
                onClick={() => setColor(c.color)}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition",
                  color === c.color
                    ? "border-foreground scale-110"
                    : "border-border hover:border-foreground/60",
                )}
                style={{ background: c.color }}
                title={c.label}
              />
            ))}
          </div>
          <div className="mx-2 h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Label className="text-[10px]">Tebal</Label>
            <input
              type="range"
              min={2}
              max={20}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={clearCanvas} className="text-xs">
              Bersihkan
            </Button>
          </div>
        </div>

        <div className="relative flex-1 overflow-auto bg-[repeating-conic-gradient(#0002_0%_25%,transparent_0%_50%)_50%/24px_24px] p-4">
          <div className="relative mx-auto max-w-full" style={{ width: "fit-content" }}>
            <img
              src={target.image}
              alt=""
              className="block max-h-[65vh] w-auto rounded"
              draggable={false}
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              className="absolute inset-0 h-full w-full touch-none rounded"
              style={{ cursor: "crosshair" }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Setiap warna akan menjadi baris prompt sendiri di node "Sketsa Perbaikan".
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Batal
            </Button>
            <Button
              size="sm"
              onClick={makeNode}
              className="bg-gradient-primary shadow-primary"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Jadikan Node
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
      const inEdges = (target: string) =>
        graph.edges.filter((e) => e.target === target);
      const outEdges = (source: string) =>
        graph.edges.filter((e) => e.source === source);

      const incoming = inEdges(renderNodeId);
      const incomingNodes = incoming
        .map((e) => graph.nodes.find((n) => n.id === e.source))
        .filter(Boolean) as Node[];

      const promptNode = incomingNodes.find((n) => n.type === "prompt");
      const editNode = incomingNodes.find((n) => n.type === "edit");

      // Reference Style attaches to the Prompt node (visual style addition to
      // the prompt). Geometry is anchored to the Input node, not the reference.
      const referenceNode = promptNode
        ? (graph.edges
            .filter((e) => e.target === promptNode.id)
            .map((e) => graph.nodes.find((n) => n.id === e.source))
            .find((n) => n?.type === "reference") ?? null)
        : incomingNodes.find((n) => n.type === "reference") ?? null;

      const outEdgeR = outEdges(renderNodeId)[0];
      const outputNode = outEdgeR
        ? graph.nodes.find((n) => n.id === outEdgeR.target)
        : null;

      if (!outputNode) return toast.error("Sambungkan Render → Output");

      const outData = outputNode.data as OutputNodeData;
      const refImage = referenceNode
        ? (referenceNode.data as ReferenceNodeData).image ?? null
        : null;

      // === EDIT FLOW: single-image inpaint-style render ===
      if (editNode && outData.standalone) {
        const ed = editNode.data as EditNodeData;
        const colorPart = ed.colorPrompts
          .filter((c) => c.prompt.trim())
          .map((c) => `Coretan ${c.label} (${c.color}): ${c.prompt.trim()}`)
          .join(". ");
        const finalPrompt = [
          "Perbaiki gambar berikut sesuai anotasi coretan berwarna pada gambar",
          colorPart || "Perbaiki area yang ditandai",
          "Hasilkan foto arsitektur fotorealistis berkualitas tinggi, jaga geometry utama",
        ].join(". ");

        updateNode(outputNode.id, {
          standaloneStatus: "processing",
          standaloneProgress: 10,
          standaloneError: undefined,
        });
        updateNode(renderNodeId, { status: "processing", progress: 0 });
        try {
          const res = await callRender({
            data: {
              sketchBase64: ed.annotatedImage,
              referenceBase64: refImage,
              prompt: finalPrompt,
              renderType: "exterior",
              accuracy: 9,
              consistency: refImage ? 8 : 5,
            },
          });
          if (res.ok && res.resultUrl) {
            let dataUrl = res.resultUrl;
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
              /* fallback to url */
            }
            updateNode(outputNode.id, {
              standaloneImage: dataUrl,
              standaloneStatus: "done",
              standaloneProgress: 100,
            });
            updateNode(renderNodeId, { status: "done", progress: 100 });
            toast.success("Perbaikan selesai");
          } else {
            updateNode(outputNode.id, {
              standaloneStatus: "error",
              standaloneError: res.ok ? "Tidak ada URL" : res.error,
            });
            updateNode(renderNodeId, {
              status: "error",
              error: res.ok ? "Tidak ada URL" : res.error,
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Error";
          updateNode(outputNode.id, { standaloneStatus: "error", standaloneError: msg });
          updateNode(renderNodeId, { status: "error", error: msg });
        }
        return;
      }

      // === STANDARD FLOW: input + prompt → multi-angle output ===
      if (!promptNode) return toast.error("Sambungkan Prompt ke Render Engine");
      const inputEdge = inEdges(promptNode.id)[0];
      const inputNode = inputEdge
        ? graph.nodes.find((n) => n.id === inputEdge.source)
        : null;
      if (!inputNode) return toast.error("Sambungkan Input ke Prompt");

      const inData = inputNode.data as InputNodeData;
      const prData = promptNode.data as PromptNodeData;

      const shots = loadShots(inData.sketchId);
      const uploads = inData.uploads ?? [];
      const pool: { id: string; dataUrl: string }[] = [
        ...shots.map((s) => ({ id: s.id, dataUrl: s.dataUrl })),
        ...uploads.map((u) => ({ id: u.id, dataUrl: u.dataUrl })),
      ];
      const chosen = pool.find((s) => s.id === inData.selectedShotId) ?? pool[0];
      if (!chosen)
        return toast.error(`Pilih atau unggah gambar untuk ${inData.sketchTitle}`);

      const finalPrompt = [
        prData.style,
        prData.detail,
        refImage
          ? "Gunakan gambar referensi HANYA sebagai panduan gaya visual (palet, material, mood, pencahayaan). GEOMETRY tetap mengikuti sketsa input — jangan meniru bentuk atau komposisi dari referensi."
          : "",
        "arsitektur fotorealistis, kualitas tinggi",
      ]
        .filter(Boolean)
        .join(", ");
      if (!finalPrompt.trim()) return toast.error("Isi gaya atau detail prompt");

      const promptGeom = Math.max(0, Math.min(100, prData.geometryConsistency ?? 70));
      const outputGeom = Math.max(0, Math.min(100, outData.geometryConsistency ?? 80));
      const accuracyLevel = Math.max(1, Math.min(10, Math.round((promptGeom / 100) * 9) + 1));
      const angleConsistencyText =
        outputGeom >= 90
          ? "KRITIS: Pertahankan geometry PERSIS SAMA di semua angle."
          : outputGeom >= 60
            ? `Jaga konsistensi bentuk ${outputGeom}% antar angle.`
            : outputGeom >= 30
              ? `Boleh variasi bentuk ~${100 - outputGeom}% antar angle.`
              : "Bebas variasi bentuk tiap angle.";

      const angles: RenderAngle[] = DEFAULT_ANGLES.map((a) => ({
        id: crypto.randomUUID(),
        angle: a,
        image: null,
        status: "processing",
        progress: 5,
      }));
      setOutputs(outData.sketchId, angles);
      updateNode(renderNodeId, { status: "processing", progress: 0, error: undefined });

      const timers: Record<string, ReturnType<typeof setInterval>> = {};
      for (const a of angles) {
        timers[a.id] = setInterval(() => {
          const cur = useStudioStore
            .getState()
            .graph.outputs[outData.sketchId]?.find((o) => o.id === a.id);
          if (!cur || cur.status !== "processing") return;
          const next = Math.min(cur.progress + 3 + Math.random() * 4, 90);
          updateOutput(outData.sketchId, a.id, { progress: next });
        }, 400);
      }

      try {
        const results = await Promise.all(
          angles.map(async (a) => {
            const anglePrompt = `${finalPrompt}. ${ANGLE_PROMPT[a.angle] ?? a.angle}. ${angleConsistencyText}`;
            try {
              const res = await callRender({
                data: {
                  sketchBase64: chosen.dataUrl,
                  referenceBase64: refImage,
                  prompt: anglePrompt,
                  renderType: "exterior",
                  accuracy: accuracyLevel,
                  consistency: Math.max(
                    1,
                    Math.min(10, Math.round((outputGeom / 100) * 9) + 1),
                  ),
                },
              });
              clearInterval(timers[a.id]);
              if (res.ok && res.resultUrl) {
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
          status: success > 0 ? "done" : "error",
          progress: 100,
          error: success === 0 ? "Semua angle gagal" : undefined,
        });
        if (success > 0) {
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
          geometryConsistency: 70,
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
          geometryConsistency: 80,
        } satisfies OutputNodeData,
      },
    );
    const mkEdge = (source: string, target: string): Edge => ({
      id: `${source}->${target}`,
      source,
      target,
      animated: true,
      style: { stroke: "hsl(24 95% 53%)", strokeWidth: 2 },
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
  const addNode = useStudioStore((s) => s.addNode);
  const addEdgeStore = useStudioStore((s) => s.addEdge);

  const [sketches, setSketches] = useState<SketchLite[]>([]);
  const [annotationTarget, setAnnotationTarget] = useState<AnnotationTarget | null>(null);
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

  // Spawn node from dropdown
  const spawnNode = (kind: "input" | "prompt" | "render" | "output" | "reference" | "edit") => {
    const anchor = { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 };
    const uid = crypto.randomUUID().slice(0, 8);
    const sk = sketches[0];
    if ((kind === "input" || kind === "output") && !sk) {
      toast.error("Belum ada sketsa. Buat sketsa dulu.");
      return;
    }
    let node: Node | null = null;
    if (kind === "input" && sk) {
      node = {
        id: `input-manual-${uid}`,
        type: "input",
        position: anchor,
        data: {
          kind: "input",
          sketchId: sk.id,
          sketchTitle: sk.title,
          selectedShotId: null,
          uploads: [],
        } satisfies InputNodeData,
      };
    } else if (kind === "prompt") {
      node = {
        id: `prompt-manual-${uid}`,
        type: "prompt",
        position: anchor,
        data: {
          kind: "prompt",
          style: "",
          detail: "",
          geometryConsistency: 70,
        } satisfies PromptNodeData,
      };
    } else if (kind === "render") {
      node = {
        id: `render-manual-${uid}`,
        type: "render",
        position: anchor,
        data: { kind: "render", status: "idle", progress: 0 } satisfies RenderNodeData,
      };
    } else if (kind === "output" && sk) {
      node = {
        id: `output-manual-${uid}`,
        type: "output",
        position: anchor,
        data: {
          kind: "output",
          sketchId: sk.id,
          sketchTitle: sk.title,
          geometryConsistency: 80,
        } satisfies OutputNodeData,
      };
    } else if (kind === "reference") {
      node = {
        id: `reference-${uid}`,
        type: "reference",
        position: anchor,
        data: {
          kind: "reference",
          image: null,
          label: "Referensi Style",
        } satisfies ReferenceNodeData,
      };
    } else if (kind === "edit") {
      toast.info("Node Edit dibuat dari klik gambar di Output — lalu tekan 'Jadikan Node'.");
      return;
    }
    if (node) {
      addNode(node);
      toast.success(`Node ditambahkan`);
    }
  };

  // Handle "Jadikan Node" from annotation modal
  const handleMakeEditNode = (annotatedDataUrl: string, usedColors: string[]) => {
    if (!annotationTarget) return;
    const uid = crypto.randomUUID().slice(0, 8);
    const editId = `edit-${uid}`;
    const renderId = `render-edit-${uid}`;
    const outputId = `output-edit-${uid}`;

    // Locate source output node to anchor near it
    const outputNode = graph.nodes.find(
      (n) =>
        n.type === "output" &&
        (n.data as OutputNodeData).sketchId === annotationTarget.sketchId &&
        !(n.data as OutputNodeData).standalone,
    );
    const base = outputNode
      ? { x: outputNode.position.x + 340, y: outputNode.position.y + 60 }
      : { x: 800, y: 200 };

    const colorPrompts =
      usedColors.length > 0
        ? usedColors.map((c) => ({
            color: c,
            label: ANNOTATION_COLORS.find((x) => x.color === c)?.label ?? c,
            prompt: "",
          }))
        : ANNOTATION_COLORS.slice(0, 2).map((c) => ({
            color: c.color,
            label: c.label,
            prompt: "",
          }));

    addNode({
      id: editId,
      type: "edit",
      position: base,
      data: {
        kind: "edit",
        sketchId: annotationTarget.sketchId,
        sketchTitle: annotationTarget.sketchTitle,
        sourceImage: annotationTarget.image,
        annotatedImage: annotatedDataUrl,
        colorPrompts,
      } satisfies EditNodeData,
    });
    addNode({
      id: renderId,
      type: "render",
      position: { x: base.x + 340, y: base.y },
      data: { kind: "render", status: "idle", progress: 0 } satisfies RenderNodeData,
    });
    addNode({
      id: outputId,
      type: "output",
      position: { x: base.x + 680, y: base.y },
      data: {
        kind: "output",
        sketchId: annotationTarget.sketchId,
        sketchTitle: annotationTarget.sketchTitle,
        geometryConsistency: 90,
        standalone: true,
        standaloneImage: null,
        standaloneStatus: "idle",
        standaloneProgress: 0,
      } satisfies OutputNodeData,
    });
    addEdgeStore({
      id: `${editId}->${renderId}`,
      source: editId,
      target: renderId,
      animated: true,
      style: { stroke: "hsl(180 70% 45%)", strokeWidth: 2 },
    });
    addEdgeStore({
      id: `${renderId}->${outputId}`,
      source: renderId,
      target: outputId,
      animated: true,
      style: { stroke: "hsl(24 95% 53%)", strokeWidth: 2 },
    });

    setAnnotationTarget(null);
    toast.success("Node Sketsa Perbaikan + Render + Output dibuat");
  };

  // Node types with annotation callback baked in
  const nodeTypes = useMemo(
    () => ({
      input: InputNode,
      prompt: PromptNode,
      render: RenderNode,
      output: (props: NodeProps) => (
        <OutputNode {...props} onAnnotate={setAnnotationTarget} />
      ),
      reference: ReferenceNode,
      edit: EditNode,
    }),
    [],
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
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1">
                <Plus className="h-3.5 w-3.5" /> Tambah Node
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Node Utama</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => spawnNode("input")}>
                1 · 3D Input
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("prompt")}>
                2 · Prompt & Style
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("render")}>
                3 · AI Render Engine
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("output")}>
                4 · Multi-Angle Output
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Node Lanjutan</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => spawnNode("reference")}>
                Referensi Style
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("edit")}>
                Sketsa Perbaikan (via anotasi)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Render Studio · Node Canvas
            </h1>
            <p className="text-xs text-muted-foreground">
              {sketches.length} sketsa · {graph.nodes.length} node · {totalOutputs} render selesai
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={clearAll}
            disabled={graph.nodes.length === 0}
          >
            Bersihkan
          </Button>
          <Button size="sm" onClick={loadPreset} className="bg-gradient-primary shadow-primary">
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
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: "hsl(24 95% 53%)", strokeWidth: 2 },
            }}
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
                  case "input":
                    return "#0ea5e9";
                  case "prompt":
                    return "#8b5cf6";
                  case "render":
                    return "#f59e0b";
                  case "output":
                    return "#10b981";
                  case "reference":
                    return "#ec4899";
                  case "edit":
                    return "#06b6d4";
                  default:
                    return "#888";
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
                Klik <span className="font-medium">Load Default Render Preset</span> atau{" "}
                <span className="font-medium">Tambah Node</span> di kiri atas.
              </p>
            </div>
          </div>
        )}
      </div>

      {annotationTarget && (
        <AnnotationModal
          target={annotationTarget}
          onClose={() => setAnnotationTarget(null)}
          onMakeNode={handleMakeEditNode}
        />
      )}
    </main>
  );
}
