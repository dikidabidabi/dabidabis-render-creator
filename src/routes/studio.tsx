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
  Copy,
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
import { upscaleTile } from "@/lib/upscale-tile.functions";
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
  const out: SketchLite[] = [];
  const seen = new Set<string>();
  const push = (arr?: { id: string; title: string }[]) => {
    if (!arr) return;
    for (const x of arr) {
      if (x?.id && !seen.has(x.id)) {
        seen.add(x.id);
        out.push({ id: x.id, title: x.title ?? "(tanpa judul)" });
      }
    }
  };
  for (const key of ["dabidabis_sketch_v2", "dabidabis_masterplan_canvas_v1"]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const s = JSON.parse(raw) as { sketches?: { id: string; title: string }[] };
      push(s.sketches);
    } catch {
      /* ignore */
    }
  }
  return out;
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
function hasShots(sketchId: string): boolean {
  return loadShots(sketchId).length > 0;
}
function sketchesWithShots(list: SketchLite[]): SketchLite[] {
  return list.filter((s) => hasShots(s.id));
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

/** Sketch list restricted to those with at least one screenshot in library. */
function useSketchesWithShots(): SketchLite[] {
  const all = useSketchList();
  const [ver, setVer] = useState(0);
  useEffect(() => {
    const reload = () => setVer((v) => v + 1);
    window.addEventListener("storage", reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("focus", reload);
    };
  }, []);
  return useMemo(() => sketchesWithShots(all), [all, ver]);
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

// Perkiraan biaya kredit Lovable per gambar per model (berdasarkan log AI Gateway).
// Digunakan untuk menampilkan estimasi pemakaian kredit & rupiah di node output.
const MODEL_CREDIT_COST: Record<string, number> = {
  "google/gemini-2.5-flash-image": 0.039,
  "google/gemini-3.1-flash-image": 0.039,
  "google/gemini-3-pro-image": 0.56,
};
// 1 kredit Lovable ≈ Rp 4.000 (Pro plan: $25 / 100 kredit @ ~Rp 16.000/USD).
const IDR_PER_CREDIT = 4000;
function estimateCredits(model?: string): number {
  return MODEL_CREDIT_COST[model ?? ""] ?? MODEL_CREDIT_COST["google/gemini-2.5-flash-image"];
}
function formatIDR(v: number): string {
  return "Rp " + Math.round(v).toLocaleString("id-ID");
}

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
  model?: "google/gemini-2.5-flash-image" | "google/gemini-3.1-flash-image" | "google/gemini-3-pro-image";
};

type OutputNodeData = {
  kind: "output";
  sketchId: string;
  sketchTitle: string;
  geometryConsistency: number;
  // For "edit output" nodes we render a single image (not multi-angle)
  standalone?: boolean;
  // For "single output" nodes — one image dari pool input, tampilan mirip standalone
  singleOutput?: boolean;
  selectedShotId?: string | null;
  standaloneImage?: string | null;
  standaloneStatus?: "idle" | "processing" | "done" | "error";
  standaloneProgress?: number;
  standaloneError?: string;
  standaloneCredits?: number;
  standaloneModel?: string;
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
type UpscaleModel =
  | "google/gemini-2.5-flash-image"
  | "google/gemini-3.1-flash-image"
  | "google/gemini-3-pro-image";
type UpscaleNodeData = {
  kind: "upscale";
  model: UpscaleModel;
  resolution: "2K" | "4K" | "8K";
  sourceImage?: string | null;
  sourceLabel?: string;
  status?: "idle" | "processing" | "done" | "error";
  progress?: number;
  error?: string;
  resultImage?: string | null;
  credits?: number;
  targetSketchId?: string;
  targetSketchTitle?: string;
  // Tiled upscaling (Ubin AI)
  tiled?: boolean;
  tileOverlap?: number; // 0.10 – 0.25 (fraction)
  denoisingStrength?: number; // 0.15 – 0.45
  tilesTotal?: number;
  tilesDone?: number;
  tileStatus?: string;
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
  tone: "input" | "prompt" | "render" | "output" | "reference" | "edit" | "upload" | "upscale";
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
    upload: "border-indigo-500/40 bg-indigo-500/5",
    upscale: "border-fuchsia-500/40 bg-fuchsia-500/5",
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
  const sketches = useSketchesWithShots();
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

// ---------- Upload Input Node (gambar eksternal, tanpa 3D screenshot) ----------
type UploadNodeData = {
  kind: "upload";
  sketchId: string; // synthetic id (upload-<uid>) — reused by Output/executor
  sketchTitle: string; // editable label, mis. "Unggahan Eksternal"
  selectedShotId: string | null;
  uploads: UploadedShot[];
};

function UploadNode({ id, data }: NodeProps) {
  const d = data as UploadNodeData;
  const updateNode = useStudioStore((s) => s.updateNode);
  const removeNode = useStudioStore((s) => s.removeNode);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploads = d.uploads ?? [];

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
      title="Unggah Input"
      icon={<Upload className="h-3.5 w-3.5 text-indigo-500" />}
      tone="upload"
      hasSource
      onRemove={() => removeNode(id)}
    >
      <div className="space-y-2">
        <input
          value={d.sketchTitle}
          onChange={(e) => updateNode(id, { sketchTitle: e.target.value })}
          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-[11px] font-medium outline-none focus:border-indigo-500"
          placeholder="Nama sumber (mis. Konsep Klien)"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {uploads.length} gambar diunggah
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 hover:bg-indigo-500/25"
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
        {uploads.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-indigo-500/40 bg-indigo-500/5 text-[11px] text-indigo-600 hover:bg-indigo-500/10"
          >
            <Upload className="h-4 w-4" />
            Unggah gambar dari luar (JPG/PNG)
          </button>
        ) : (
          <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
            {uploads.map((u) => (
              <div key={u.id} className="group relative">
                <button
                  type="button"
                  onClick={() => updateNode(id, { selectedShotId: u.id })}
                  className={cn(
                    "block w-full overflow-hidden rounded border-2 transition",
                    d.selectedShotId === u.id
                      ? "border-ember ring-1 ring-ember/50"
                      : "border-transparent hover:border-border",
                  )}
                >
                  <img src={u.dataUrl} alt={u.name ?? ""} className="aspect-[4/3] w-full object-cover" />
                </button>
                <button
                  onClick={() => removeUpload(u.id)}
                  className="absolute right-0.5 top-0.5 rounded bg-black/70 p-0.5 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-500/80"
                  title="Hapus gambar"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[9px] leading-tight text-muted-foreground">
          Setiap gambar akan dirender sebagai satu output. Hubungkan ke <b>Prompt & Style</b>.
        </p>
      </div>
    </NodeShell>
  );
}


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
          <div className="relative mt-1">
            <Textarea
              value={d.style}
              onChange={(e) => {
                updateNode(id, { style: e.target.value });
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
                }
              }}
              rows={1}
              placeholder="mis. bare finish concrete"
              className="min-h-[64px] overflow-hidden pr-10 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                const text = d.style ?? "";
                if (!text.trim()) { toast.error("Gaya arsitektur kosong"); return; }
                try { navigator.clipboard.writeText(text); toast.success("Gaya arsitektur disalin"); } catch { toast.error("Gagal menyalin"); }
              }}
              className="absolute right-1 top-1 rounded border border-border/60 bg-background/90 p-1 text-[9px] hover:border-ember"
              title="Salin gaya arsitektur"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
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
          <div className="flex items-center justify-between">
            <Label className="text-[10px]">Detail tambahan</Label>
            <button
              type="button"
              onClick={() => {
                const text = d.detail ?? "";
                if (!text.trim()) { toast.error("Prompt kosong"); return; }
                try {
                  navigator.clipboard.writeText(text);
                  toast.success("Prompt disalin");
                } catch { toast.error("Gagal menyalin"); }
              }}
              className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[9px] hover:border-ember"
              title="Salin prompt"
            >
              <Copy className="h-2.5 w-2.5" /> Salin
            </button>
          </div>
          <Textarea
            value={d.detail}
            onChange={(e) => {
              updateNode(id, { detail: e.target.value });
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
            }}
            ref={(el) => {
              if (el) {
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
              }
            }}
            rows={3}
            placeholder="Konteks vegetasi, cuaca, aktivitas..."
            className="mt-1 min-h-[64px] overflow-hidden text-xs"
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
  const updateNode = useStudioStore((s) => s.updateNode);
  const trigger = useStudioExecute();
  const currentModel = d.model ?? "google/gemini-2.5-flash-image";
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
        <div>
          <Label className="text-[10px]">Model AI</Label>
          <select
            value={currentModel}
            onChange={(e) => updateNode(id, { model: e.target.value })}
            className="mt-1 w-full rounded border border-border/60 bg-background px-2 py-1 text-[11px] font-medium outline-none focus:border-amber-500"
          >
            <option value="google/gemini-2.5-flash-image">Gemini 2.5 Flash Image (default)</option>
            <option value="google/gemini-3.1-flash-image">Gemini 3.1 Flash Image</option>
            <option value="google/gemini-3-pro-image">Gemini 3 Pro Image</option>
          </select>
        </div>
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
  const sketches = useSketchesWithShots();


  // Standalone output (from edit node) OR single-output pick
  if (d.standalone || d.singleOutput) {
    const status = d.standaloneStatus ?? "idle";
    const isSingle = !!d.singleOutput;
    const shots = isSingle ? loadShots(d.sketchId) : [];
    const selectedShotId = d.selectedShotId ?? shots[0]?.id ?? null;
    return (
      <NodeShell
        title={isSingle ? `Single Output · ${d.sketchTitle}` : `Output Perbaikan · ${d.sketchTitle}`}
        icon={<Layers className="h-3.5 w-3.5 text-emerald-500" />}
        tone="output"
        hasTarget
        hasSource={!!d.standaloneImage}
        onRemove={() => removeNode(id)}
      >
        <div className="space-y-2">
          {isSingle && (
            <>
              <SketchSelector
                sketches={sketches}
                value={d.sketchId}
                tone="emerald"
                onChange={(sk) =>
                  updateNode(id, {
                    sketchId: sk.id,
                    sketchTitle: sk.title,
                    selectedShotId: null,
                    standaloneImage: null,
                    standaloneStatus: "idle",
                  })
                }
              />
              {shots.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  Belum ada screenshot untuk sketsa ini.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {shots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => updateNode(id, { selectedShotId: s.id })}
                      className={cn(
                        "block w-full overflow-hidden rounded border-2 transition",
                        selectedShotId === s.id
                          ? "border-ember ring-1 ring-ember/50"
                          : "border-transparent hover:border-border",
                      )}
                    >
                      <img src={s.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="relative aspect-[4/3] overflow-hidden rounded border border-border/60 bg-background">
            {d.standaloneImage ? (
              <img
                src={d.standaloneImage}
                alt={isSingle ? "Hasil render" : "Hasil perbaikan"}
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
          {d.standaloneImage && d.standaloneCredits ? (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-[10px] space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-emerald-600">Kredit AI terpakai</span>
                <span className="font-semibold tabular-nums text-emerald-600">
                  {d.standaloneCredits.toFixed(3)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Estimasi biaya</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatIDR(d.standaloneCredits * IDR_PER_CREDIT)}
                </span>
              </div>
              {d.standaloneModel && (
                <div className="text-[9px] text-muted-foreground">
                  {d.standaloneModel.replace("google/", "")}
                </div>
              )}
            </div>
          ) : null}
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
                    id: `studio-${isSingle ? "single" : "edit"}-${id}`,
                    title: `${d.sketchTitle} · ${isSingle ? "Single" : "Perbaikan"}`,
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
  const totalCredits = outputs.reduce((s, o) => s + (o.credits ?? 0), 0);
  const usedModels = Array.from(new Set(outputs.map((o) => o.model).filter(Boolean))) as string[];

  return (
    <NodeShell
      title="Multi-Angle Output"
      icon={<Layers className="h-3.5 w-3.5 text-emerald-500" />}
      tone="output"
      hasTarget
      onRemove={() => removeNode(id)}
    >
      <div className="space-y-2">
        <SketchSelector
          sketches={sketches}
          value={d.sketchId}
          tone="emerald"
          onChange={(sk) => updateNode(id, { sketchId: sk.id, sketchTitle: sk.title })}
        />


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
        <div className="space-y-1.5">
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
              className="relative flex items-center gap-2 rounded border border-border/60 bg-background p-1 pr-3"
            >
              <div
                className={cn(
                  "relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded",
                  o.image && "cursor-pointer hover:ring-1 hover:ring-ember",
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
                  <img src={o.image} alt={o.angle} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-muted/40">
                    {o.status === "processing" ? (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    ) : (
                      <ImageIcon className="h-3 w-3 text-muted-foreground/40" />
                    )}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 text-[10px]">
                <div className="truncate font-medium">{o.angle}</div>
                {o.status === "processing" && (
                  <div className="text-muted-foreground">{Math.round(o.progress)}%</div>
                )}
                {o.status === "done" && (
                  <div className="text-emerald-600">Selesai</div>
                )}
                {o.status === "error" && (
                  <div className="truncate text-destructive" title={o.error}>Gagal</div>
                )}
              </div>
              {o.image && (
                <a
                  href={o.image}
                  download={`${d.sketchTitle}-${o.angle}.png`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Unduh gambar"
                >
                  <Download className="h-3 w-3" />
                </a>
              )}
              {o.image && (
                <Handle
                  id={`img-${o.id}`}
                  type="source"
                  position={Position.Right}
                  isConnectable
                  className="!h-3 !w-3 !border-2 !border-background !bg-emerald-500 !cursor-crosshair"
                  style={{ right: -6, zIndex: 20 }}
                  title="Sambungkan gambar ini ke node Upscale"
                />
              )}
            </div>
          ))}
        </div>

        {done > 0 && totalCredits > 0 && (
          <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-[10px] space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-emerald-600">Kredit AI terpakai</span>
              <span className="font-semibold tabular-nums text-emerald-600">
                {totalCredits.toFixed(3)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Estimasi biaya</span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatIDR(totalCredits * IDR_PER_CREDIT)}
              </span>
            </div>
            <div className="text-[9px] text-muted-foreground">
              {done} render · {usedModels.map((m) => m.replace("google/", "")).join(", ")}
            </div>
          </div>
        )}
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

// ---------- Upscale Node ----------
function UpscaleNode({
  id,
  data,
  onRun,
}: NodeProps & { onRun?: (id: string) => void }) {
  const d = data as UpscaleNodeData;
  const updateNode = useStudioStore((s) => s.updateNode);
  const removeNode = useStudioStore((s) => s.removeNode);
  const sketches = useSketchesWithShots();
  const model = d.model ?? "google/gemini-2.5-flash-image";
  const resolution = d.resolution ?? "2K";
  const status = d.status ?? "idle";
  const targetSketch =
    sketches.find((s) => s.id === d.targetSketchId) ?? sketches[0] ?? null;

  return (
    <NodeShell
      title="Upscale AI"
      icon={<Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />}
      tone="upscale"
      hasTarget
      onRemove={() => removeNode(id)}
    >
      <div className="space-y-2">
        <div>
          <Label className="text-[10px]">Model AI</Label>
          <select
            value={model}
            onChange={(e) => updateNode(id, { model: e.target.value })}
            className="mt-1 w-full rounded border border-border/60 bg-background px-2 py-1 text-[11px] font-medium outline-none focus:border-fuchsia-500"
          >
            <option value="google/gemini-2.5-flash-image">Gemini 2.5 Flash Image</option>
            <option value="google/gemini-3.1-flash-image">Gemini 3.1 Flash Image</option>
            <option value="google/gemini-3-pro-image">Gemini 3 Pro Image</option>
          </select>
        </div>
        <div>
          <Label className="text-[10px]">Resolusi</Label>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {(["2K", "4K", "8K"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => updateNode(id, { resolution: r })}
                className={cn(
                  "rounded border px-2 py-1 text-[11px] font-medium",
                  resolution === r
                    ? "border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-600"
                    : "border-border/60 hover:border-fuchsia-500/40",
                )}
              >
                {r === "2K" ? "2K · 2560×1440" : r === "4K" ? "4K · 3840×2160" : "8K · 7680×4320"}
              </button>
            ))}
          </div>
        </div>

        {/* Tiled Upscaling (Ubin AI) */}
        <div className="rounded border border-fuchsia-500/30 bg-fuchsia-500/5 p-2 space-y-2">
          <label className="flex items-center justify-between gap-2 text-[11px] font-medium cursor-pointer">
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3 text-fuchsia-500" />
              Tiled Upscaling (Ubin AI)
            </span>
            <input
              type="checkbox"
              checked={!!d.tiled}
              onChange={(e) => updateNode(id, { tiled: e.target.checked })}
              className="h-3.5 w-3.5 accent-fuchsia-500"
            />
          </label>
          {d.tiled ? (
            <>
              <div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Tile Overlap</span>
                  <span className="tabular-nums">
                    {Math.round((d.tileOverlap ?? 0.15) * 100)}%
                  </span>
                </div>
                <Slider
                  min={10}
                  max={25}
                  step={1}
                  value={[Math.round((d.tileOverlap ?? 0.15) * 100)]}
                  onValueChange={(v) => updateNode(id, { tileOverlap: v[0] / 100 })}
                  className="mt-1"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Denoising Strength</span>
                  <span className="tabular-nums">
                    {(d.denoisingStrength ?? 0.3).toFixed(2)}
                  </span>
                </div>
                <Slider
                  min={15}
                  max={45}
                  step={1}
                  value={[Math.round((d.denoisingStrength ?? 0.3) * 100)]}
                  onValueChange={(v) => updateNode(id, { denoisingStrength: v[0] / 100 })}
                  className="mt-1"
                />
              </div>
              <p className="text-[9px] leading-tight text-muted-foreground">
                Grid: {resolution === "2K" ? "2×2" : resolution === "4K" ? "4×4" : "8×8"} ubin ·
                Flash untuk ubin, feather blending untuk sambungan.
              </p>
            </>
          ) : null}
        </div>

        <div className="relative aspect-[4/3] overflow-hidden rounded border border-border/60 bg-background">
          {d.resultImage ? (
            <img src={d.resultImage} alt="Upscaled" className="h-full w-full object-cover" />
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
        {status === "processing" && d.tilesTotal ? (
          <div className="space-y-1">
            <div className="h-1 rounded bg-muted overflow-hidden">
              <div
                className="h-full bg-fuchsia-500 transition-all"
                style={{
                  width: `${Math.round(((d.tilesDone ?? 0) / d.tilesTotal) * 100)}%`,
                }}
              />
            </div>
            <p className="text-[9px] text-muted-foreground">
              {d.tileStatus ?? `Ubin ${d.tilesDone ?? 0}/${d.tilesTotal}`}
            </p>
          </div>
        ) : null}
        {d.sourceLabel && (
          <p className="truncate text-[9px] text-muted-foreground">Sumber: {d.sourceLabel}</p>
        )}
        {status === "error" && (
          <p className="text-[10px] text-destructive">{d.error ?? "Upscale gagal."}</p>
        )}
        <Button
          size="sm"
          disabled={status === "processing"}
          onClick={() => onRun?.(id)}
          className="w-full bg-gradient-primary text-xs shadow-primary"
        >
          {status === "processing" ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Upscaling…
            </>
          ) : (
            <>
              <Play className="mr-1 h-3 w-3" />
              {d.tiled ? `Execute Tiled Upscale ${resolution}` : `Upscale ke ${resolution}`}
            </>
          )}
        </Button>
        {d.resultImage && d.credits ? (
          <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-[10px] space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-emerald-600">Kredit AI terpakai</span>
              <span className="font-semibold tabular-nums text-emerald-600">
                {d.credits.toFixed(3)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Estimasi biaya</span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatIDR(d.credits * IDR_PER_CREDIT)}
              </span>
            </div>
            <div className="text-[9px] text-muted-foreground">
              {model.replace("google/", "")} · {resolution}
            </div>
          </div>
        ) : null}
        {d.resultImage && (
          <a
            href={d.resultImage}
            download={`upscale-${resolution}.png`}
            className="flex w-full items-center justify-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] hover:border-ember"
          >
            <Download className="h-3 w-3" /> Unduh
          </a>
        )}
        <div className="pt-1 border-t border-border/40">
          <Label className="text-[10px]">Kirim ke presentasi</Label>
          {sketches.length === 0 ? (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Belum ada sketsa dengan screenshot.
            </p>
          ) : (
            <div className="mt-1 space-y-1">
              <SketchSelector
                sketches={sketches}
                value={targetSketch?.id ?? ""}
                tone="emerald"
                onChange={(sk) =>
                  updateNode(id, { targetSketchId: sk.id, targetSketchTitle: sk.title })
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!d.resultImage || !targetSketch}
                onClick={() => {
                  if (!d.resultImage || !targetSketch) return;
                  try {
                    const raw = localStorage.getItem("dabidabis_perspektif_v1");
                    const store: Record<
                      string,
                      { id: string; title: string; image: string | null }[]
                    > = raw ? JSON.parse(raw) : {};
                    const items = store[targetSketch.id] ?? [];
                    items.push({
                      id: `studio-upscale-${id}`,
                      title: `${targetSketch.title} · Upscale ${resolution}`,
                      image: d.resultImage,
                    });
                    store[targetSketch.id] = items;
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
            </div>
          )}
        </div>
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

      const renderNode = graph.nodes.find((n) => n.id === renderNodeId);
      const selectedModel = (renderNode?.data as RenderNodeData | undefined)?.model
        ?? "google/gemini-2.5-flash-image";

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
              model: selectedModel,
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
              standaloneCredits: estimateCredits(res.modelUsed),
              standaloneModel: res.modelUsed,
            });
            if (res.fallbackFrom) {
              updateNode(renderNodeId, { model: res.modelUsed });
              toast.info("Model pilihan belum tersedia; render dilanjutkan dengan Gemini 2.5 Flash Image");
            }
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
      const inputNode =
        inEdges(promptNode.id)
          .map((e) => graph.nodes.find((n) => n.id === e.source))
          .find((n) => n?.type === "input" || n?.type === "upload") ?? null;
      if (!inputNode) return toast.error("Sambungkan Input / Unggah ke Prompt");

      const inData = inputNode.data as InputNodeData;
      const prData = promptNode.data as PromptNodeData;

      const shots = loadShots(inData.sketchId);
      const uploads = inData.uploads ?? [];
      const pool: { id: string; dataUrl: string }[] = [
        ...shots.map((s) => ({ id: s.id, dataUrl: s.dataUrl })),
        ...uploads.map((u) => ({ id: u.id, dataUrl: u.dataUrl })),
      ];
      if (pool.length === 0)
        return toast.error(`Belum ada screenshot / unggahan untuk ${inData.sketchTitle}`);

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
          ? "KRITIS: Pertahankan geometry PERSIS SAMA dari sketsa input."
          : outputGeom >= 60
            ? `Jaga konsistensi bentuk ${outputGeom}% dari sketsa input.`
            : outputGeom >= 30
              ? `Boleh variasi bentuk ~${100 - outputGeom}% dari sketsa input.`
              : "Bebas variasi bentuk.";

      // === SINGLE OUTPUT: one image from selected shot ===
      if (outData.singleOutput) {
        const selShot = outData.selectedShotId
          ? pool.find((p) => p.id === outData.selectedShotId)
          : null;
        const src = selShot ?? pool[0];
        updateNode(outputNode.id, {
          standaloneStatus: "processing",
          standaloneProgress: 10,
          standaloneError: undefined,
          standaloneImage: null,
        });
        updateNode(renderNodeId, { status: "processing", progress: 0 });
        try {
          const res = await callRender({
            data: {
              sketchBase64: src.dataUrl,
              referenceBase64: refImage,
              prompt: `${finalPrompt}. Ikuti sudut pandang & komposisi persis dari sketsa input. ${angleConsistencyText}`,
              renderType: "exterior",
              accuracy: accuracyLevel,
              consistency: Math.max(1, Math.min(10, Math.round((outputGeom / 100) * 9) + 1)),
              model: selectedModel,
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
              standaloneCredits: estimateCredits(res.modelUsed),
              standaloneModel: res.modelUsed,
            });
            if (res.fallbackFrom) {
              updateNode(renderNodeId, { model: res.modelUsed });
              toast.info("Model pilihan belum tersedia; render dilanjutkan dengan Gemini 2.5 Flash Image");
            }
            updateNode(renderNodeId, { status: "done", progress: 100 });
            toast.success("Single output selesai");
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


      // Output count = input count. Each output uses its own input image so the
      // camera angle mirrors the source screenshot. Naming: view 1, view 2, ...
      const angles: RenderAngle[] = pool.map((_, i) => ({
        id: crypto.randomUUID(),
        angle: `view ${i + 1}`,
        image: null,
        status: "processing",
        progress: 5,
      }));
      // For Upload flow the Output node may have no sketchId; inherit from input
      // so outputs are stored/rendered under a consistent key.
      if (!outData.sketchId && inData.sketchId) {
        updateNode(outputNode.id, {
          sketchId: inData.sketchId,
          sketchTitle: inData.sketchTitle,
        });
        outData.sketchId = inData.sketchId;
        outData.sketchTitle = inData.sketchTitle;
      }
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
          angles.map(async (a, idx) => {
            const src = pool[idx];
            const anglePrompt = `${finalPrompt}. Ikuti sudut pandang & komposisi persis dari sketsa input (${a.angle}). ${angleConsistencyText}`;
            try {
              const res = await callRender({
                data: {
                  sketchBase64: src.dataUrl,
                  referenceBase64: refImage,
                  prompt: anglePrompt,
                  renderType: "exterior",
                  accuracy: accuracyLevel,
                  consistency: Math.max(
                    1,
                    Math.min(10, Math.round((outputGeom / 100) * 9) + 1),
                  ),
                  model: selectedModel,
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
                  credits: estimateCredits(res.modelUsed),
                  model: res.modelUsed,
                });
                if (res.fallbackFrom) {
                  updateNode(renderNodeId, { model: res.modelUsed });
                }
                return true;
              }
              updateOutput(outData.sketchId, a.id, {
                status: "error",
                progress: 100,
                error: res.ok ? "Tidak ada URL" : res.error,
              });
                return res.ok ? "AI tidak menghasilkan URL gambar." : res.error;
            } catch (e) {
              clearInterval(timers[a.id]);
              updateOutput(outData.sketchId, a.id, {
                status: "error",
                progress: 100,
                error: e instanceof Error ? e.message : "Error",
              });
              return e instanceof Error ? e.message : "Render gagal";
            }
          }),
        );

        const success = results.filter((result) => result === true).length;
        const firstError = results.find((result): result is string => typeof result === "string");
        updateNode(renderNodeId, {
          status: success > 0 ? "done" : "error",
          progress: 100,
          error: success === 0 ? firstError ?? "Semua angle gagal" : undefined,
        });
        if (success > 0) {
          syncToPresentasi(outData.sketchId, outData.sketchTitle);
          toast.success(`${success}/${angles.length} angle selesai · disinkron ke Presentasi`);
        } else {
          toast.error(firstError ?? "Render gagal");
        }
      } finally {
        for (const k of Object.keys(timers)) clearInterval(timers[k]);
      }
    },
    [graph, callRender, setOutputs, updateNode, updateOutput, syncToPresentasi],
  );
}

// ---------- Upscale execute hook ----------
// Resize dataURL image to target long-edge (in px) using high-quality canvas.
// Gemini image models return a fixed ~1024–1344 px image regardless of the
// prompt, so we upscale client-side to guarantee the chosen 2K/4K dimensions.
async function upscaleDataUrl(dataUrl: string, longEdge: number): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Gagal memuat gambar untuk resize"));
    i.src = dataUrl;
  });
  const srcLong = Math.max(img.width, img.height);
  if (srcLong >= longEdge) return dataUrl; // sudah cukup besar
  const scale = longEdge / srcLong;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Two-step bicubic-like upsampling for smoother edges when scaling >1.6x.
  if (scale > 1.6) {
    const midW = Math.round(img.width * Math.sqrt(scale));
    const midH = Math.round(img.height * Math.sqrt(scale));
    const mid = document.createElement("canvas");
    mid.width = midW;
    mid.height = midH;
    const midCtx = mid.getContext("2d");
    if (midCtx) {
      midCtx.imageSmoothingEnabled = true;
      midCtx.imageSmoothingQuality = "high";
      midCtx.drawImage(img, 0, 0, midW, midH);
      ctx.drawImage(mid, 0, 0, w, h);
    } else {
      ctx.drawImage(img, 0, 0, w, h);
    }
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
  return canvas.toDataURL("image/png");
}

// ============ Tiled Upscaling (Ubin AI) helpers ============
// Grid size per target resolution.
function tileGridSize(resolution: "2K" | "4K" | "8K"): number {
  return resolution === "8K" ? 8 : resolution === "4K" ? 4 : 2;
}

// Load a data URL into an HTMLImageElement.
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal memuat gambar"));
    img.src = dataUrl;
  });
}

// Slice a source image into an NxN grid of overlapping tiles.
// Each tile is drawn onto its own canvas at native size, so the AI
// receives sharp square-ish crops. `overlapFrac` is the fraction of the
// tile size that overlaps with the neighboring tile on each side.
type Tile = {
  row: number;
  col: number;
  // Destination rectangle in the final upscaled canvas (in target pixels).
  destX: number;
  destY: number;
  destW: number;
  destH: number;
  // The tile image as a data URL (pre-AI). Client stitcher will replace
  // this with the AI-enhanced version.
  dataUrl: string;
};

async function sliceImageIntoTiles(
  srcDataUrl: string,
  grid: number,
  overlapFrac: number,
  targetW: number,
  targetH: number,
): Promise<{ tiles: Tile[]; tileW: number; tileH: number }> {
  const img = await loadImage(srcDataUrl);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;

  // Tile size in SOURCE space, with overlap. Each tile covers 1/grid of
  // the source plus overlap on inner edges.
  const baseSrcW = sw / grid;
  const baseSrcH = sh / grid;
  const overlapSrcW = baseSrcW * overlapFrac;
  const overlapSrcH = baseSrcH * overlapFrac;

  // Tile size in TARGET (upscaled) space. All tiles get the same target
  // pixel size so the AI produces uniform detail.
  const baseDstW = targetW / grid;
  const baseDstH = targetH / grid;

  const tiles: Tile[] = [];
  // Draw all AI-input tiles at a fixed working size (1024 on the long
  // edge) — Gemini image models return ~1024–1344px anyway, so this
  // gives a clean square-ish input.
  const inputLong = 1024;
  let tileW = inputLong;
  let tileH = inputLong;

  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      // Source rectangle with symmetric overlap on inner edges.
      const sx0 = Math.max(0, c * baseSrcW - (c > 0 ? overlapSrcW : 0));
      const sy0 = Math.max(0, r * baseSrcH - (r > 0 ? overlapSrcH : 0));
      const sx1 = Math.min(sw, (c + 1) * baseSrcW + (c < grid - 1 ? overlapSrcW : 0));
      const sy1 = Math.min(sh, (r + 1) * baseSrcH + (r < grid - 1 ? overlapSrcH : 0));
      const srcTileW = sx1 - sx0;
      const srcTileH = sy1 - sy0;

      // Destination rectangle in final canvas (mirrors source overlap).
      const dx0 = Math.max(0, c * baseDstW - (c > 0 ? baseDstW * overlapFrac : 0));
      const dy0 = Math.max(0, r * baseDstH - (r > 0 ? baseDstH * overlapFrac : 0));
      const dx1 = Math.min(targetW, (c + 1) * baseDstW + (c < grid - 1 ? baseDstW * overlapFrac : 0));
      const dy1 = Math.min(targetH, (r + 1) * baseDstH + (r < grid - 1 ? baseDstH * overlapFrac : 0));

      // Preserve aspect on the AI-input canvas.
      const aspect = srcTileW / srcTileH;
      const inW = aspect >= 1 ? inputLong : Math.round(inputLong * aspect);
      const inH = aspect >= 1 ? Math.round(inputLong / aspect) : inputLong;
      tileW = inW;
      tileH = inH;

      const canvas = document.createElement("canvas");
      canvas.width = inW;
      canvas.height = inH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D unavailable");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx0, sy0, srcTileW, srcTileH, 0, 0, inW, inH);
      tiles.push({
        row: r,
        col: c,
        destX: dx0,
        destY: dy0,
        destW: dx1 - dx0,
        destH: dy1 - dy0,
        dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      });
    }
  }
  return { tiles, tileW, tileH };
}

// Feathered stitching: draws each AI-enhanced tile onto the final
// canvas using an alpha mask that fades to 0 at overlap edges. This
// produces seamless linear blending between adjacent tiles.
async function stitchTiles(
  tiles: Tile[],
  grid: number,
  overlapFrac: number,
  targetW: number,
  targetH: number,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");

  for (const tile of tiles) {
    const img = await loadImage(tile.dataUrl);
    // Draw tile onto an offscreen canvas at destination size so we can
    // apply a per-pixel alpha feather mask.
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(tile.destW));
    off.height = Math.max(1, Math.round(tile.destH));
    const offCtx = off.getContext("2d");
    if (!offCtx) continue;
    offCtx.imageSmoothingEnabled = true;
    offCtx.imageSmoothingQuality = "high";
    offCtx.drawImage(img, 0, 0, off.width, off.height);

    // Feather width in pixels on each overlapping side.
    const baseDstW = targetW / grid;
    const baseDstH = targetH / grid;
    const featherX = baseDstW * overlapFrac;
    const featherY = baseDstH * overlapFrac;

    const hasLeft = tile.col > 0;
    const hasRight = tile.col < grid - 1;
    const hasTop = tile.row > 0;
    const hasBottom = tile.row < grid - 1;

    // Apply mask via ImageData (fastest cross-browser path).
    const imgData = offCtx.getImageData(0, 0, off.width, off.height);
    const data = imgData.data;
    for (let y = 0; y < off.height; y++) {
      for (let x = 0; x < off.width; x++) {
        let ax = 1;
        let ay = 1;
        if (hasLeft && x < featherX) ax = x / featherX;
        if (hasRight && x > off.width - featherX) ax = (off.width - x) / featherX;
        if (hasTop && y < featherY) ay = y / featherY;
        if (hasBottom && y > off.height - featherY) ay = (off.height - y) / featherY;
        const a = Math.max(0, Math.min(1, Math.min(ax, ay)));
        const i = (y * off.width + x) * 4 + 3;
        data[i] = Math.round(data[i] * a);
      }
    }
    offCtx.putImageData(imgData, 0, 0);

    ctx.drawImage(off, Math.round(tile.destX), Math.round(tile.destY));
  }

  return canvas.toDataURL("image/jpeg", 0.94);
}

// Sequential AI call per tile with exponential backoff on HTTP 429.
async function runTileWithRetry(
  callTile: (input: { tileBase64: string; prompt: string; model: string }) => Promise<
    | { ok: true; image: string; model: string }
    | { ok: false; status: number; error: string }
  >,
  tileBase64: string,
  prompt: string,
  model: string,
  onWait: (ms: number, attempt: number) => void,
): Promise<{ image: string; usedFallback: boolean }> {
  let delay = 2000;
  let usedFallback = false;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await callTile({ tileBase64, prompt, model });
    if (res.ok) return { image: res.image, usedFallback };
    // 429 → back off and retry the same tile.
    if (res.status === 429) {
      onWait(delay, attempt);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 32000);
      continue;
    }
    // Non-429 permanent failure → fall back to flash and try once more.
    if (!usedFallback && model !== "google/gemini-2.5-flash-image") {
      usedFallback = true;
      model = "google/gemini-2.5-flash-image";
      continue;
    }
    throw new Error(res.error);
  }
  throw new Error("Rate limit: gagal setelah beberapa percobaan.");
}


function useUpscaleExecute() {
  const graph = useStudioStore((s) => s.graph);
  const updateNode = useStudioStore((s) => s.updateNode);
  const callRender = useServerFn(generateRender);
  const callTile = useServerFn(upscaleTile);

  return useCallback(
    async (upNodeId: string) => {
      const upNode = graph.nodes.find((n) => n.id === upNodeId);
      if (!upNode) return;
      const d = upNode.data as UpscaleNodeData;
      const model = d.model ?? "google/gemini-2.5-flash-image";
      const resolution = d.resolution ?? "2K";

      const inEdge = graph.edges.find((e) => e.target === upNodeId);
      if (!inEdge) return toast.error("Sambungkan gambar output ke node Upscale");
      const src = graph.nodes.find((n) => n.id === inEdge.source);
      if (!src) return toast.error("Sumber tidak ditemukan");

      let sourceImage: string | null = null;
      let sourceLabel = "";
      let inferredSketchId: string | undefined;
      let inferredSketchTitle: string | undefined;
      if (src.type === "output") {
        const od = src.data as OutputNodeData;
        inferredSketchId = od.sketchId;
        inferredSketchTitle = od.sketchTitle;
        const handle = inEdge.sourceHandle ?? "";
        const angleId = handle.startsWith("img-") ? handle.slice(4) : undefined;
        // Prefer per-angle lookup whenever the edge came from a specific image
        // handle, regardless of standalone/singleOutput flags — the user
        // explicitly connected one view.
        if (angleId) {
          const allOutputs = useStudioStore.getState().graph.outputs;
          let angle = (allOutputs[od.sketchId] ?? []).find((o) => o.id === angleId);
          if (!angle) {
            for (const list of Object.values(allOutputs)) {
              const found = list.find((o) => o.id === angleId);
              if (found) { angle = found; break; }
            }
          }
          sourceImage = angle?.image ?? null;
          sourceLabel = `${od.sketchTitle} · ${angle?.angle ?? "view"}`;
        } else if (od.standalone || od.singleOutput) {
          sourceImage = od.standaloneImage ?? null;
          sourceLabel = `${od.sketchTitle} · ${od.singleOutput ? "Single" : "Perbaikan"}`;
        } else {
          const outs = useStudioStore.getState().graph.outputs[od.sketchId] ?? [];
          const angle = outs.find((o) => o.image);
          sourceImage = angle?.image ?? null;
          sourceLabel = `${od.sketchTitle} · ${angle?.angle ?? ""}`;
        }
      }
      if (!sourceImage) return toast.error("Gambar sumber belum tersedia");

      updateNode(upNodeId, {
        status: "processing",
        progress: 10,
        error: undefined,
        sourceImage,
        sourceLabel,
        resultImage: null,
        ...(d.targetSketchId
          ? {}
          : { targetSketchId: inferredSketchId, targetSketchTitle: inferredSketchTitle }),
      });

      // Deteksi orientasi gambar sumber agar upscale mengikuti aspek asli (portrait/landscape).
      const srcDims = await new Promise<{ w: number; h: number }>((resolve) => {
        const im = new Image();
        im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => resolve({ w: 1, h: 1 });
        im.src = sourceImage!;
      });
      const isPortrait = srcDims.h > srcDims.w;
      const longEdgePx = resolution === "8K" ? 7680 : resolution === "4K" ? 3840 : 2560;
      const shortEdgePx = Math.round(longEdgePx * (isPortrait ? srcDims.w / srcDims.h : srcDims.h / srcDims.w));
      const dimStr = isPortrait ? `${shortEdgePx}×${longEdgePx}` : `${longEdgePx}×${shortEdgePx}`;
      const orientationLabel = isPortrait ? "portrait" : "landscape";

      const prompt = [
        `Upscale presisi gambar arsitektur ini ke resolusi ${resolution} (${dimStr}, orientasi ${orientationLabel}) sekaligus lakukan resize tajam. WAJIB pertahankan orientasi dan aspek rasio gambar sumber persis — jangan crop, jangan rotasi, jangan ubah framing.`,
        "PERTAHANKAN 100% geometri bangunan, garis perspektif, proporsi, sudut pandang, komposisi, dan layout struktur asli — JANGAN mengubah bentuk, memindahkan bukaan, menggeser kolom, atau menambah/mengurangi massa apa pun.",
        "Bersihkan pantulan berlebih dan noise pada permukaan kaca sehingga kaca terlihat jernih dan realistis, tanpa mengubah bingkai atau mullion.",
        "Tajamkan pencahayaan dramatis: perkuat kontras highlight–shadow, pertegas rim light dan bounce light, pertahankan arah cahaya asli.",
        "Suntikkan tekstur mikro ultra-detail yang sesuai untuk tiap material yang tampak: pori dan agregat pada beton kasar (fair-face concrete), serat dan grain pada kayu, butiran aspal/paving pada jalan, brushed/anodized detail pada logam, urat pada batu alam, tenun pada tekstil, dedaunan pada vegetasi.",
        "Hasil akhir: foto arsitektur fotorealistis ultra-tajam kualitas portfolio, tanpa artefak AI, tanpa halusinasi elemen baru, tanpa teks/watermark.",
      ].join(" ");

      // ============ Tiled Upscaling branch ============
      if (d.tiled) {
        const grid = tileGridSize(resolution);
        const overlap = d.tileOverlap ?? 0.15;
        const denoise = d.denoisingStrength ?? 0.3;
        const targetW = isPortrait ? shortEdgePx : longEdgePx;
        const targetH = isPortrait ? longEdgePx : shortEdgePx;

        const tilePrompt = [
          `Tingkatkan ketajaman dan detail ubin gambar arsitektur ini untuk komposit ${resolution} (${dimStr}, ${orientationLabel}).`,
          "PERTAHANKAN 100% geometri, garis perspektif, dan komposisi ubin — jangan geser, jangan tambah/ubah elemen apa pun. Tepi ubin harus tetap sama agar dapat disambung mulus dengan ubin tetangga.",
          `Kekuatan penambahan detail sekitar ${denoise.toFixed(2)}: sharp architectural detail, high-resolution texture, realistic material, photorealistic micro-texture (beton, kayu, kaca, logam, aspal, vegetasi).`,
          "Tanpa teks, tanpa watermark, tanpa halusinasi elemen baru.",
        ].join(" ");

        // Flash model untuk ubin (banyak, cepat, hemat) — sesuai spec.
        const tileModel = "google/gemini-2.5-flash-image";

        updateNode(upNodeId, { tilesTotal: grid * grid, tilesDone: 0, tileStatus: "Memotong ubin…", progress: 15 });
        let sliced: { tiles: Tile[]; tileW: number; tileH: number };
        try {
          sliced = await sliceImageIntoTiles(sourceImage, grid, overlap, targetW, targetH);
        } catch (e) {
          updateNode(upNodeId, { status: "error", error: e instanceof Error ? e.message : "Slice gagal" });
          return;
        }

        const enhanced: Tile[] = [];
        let totalCredits = 0;
        for (let i = 0; i < sliced.tiles.length; i++) {
          const t = sliced.tiles[i];
          updateNode(upNodeId, {
            tileStatus: `Menajamkan ubin ${i + 1}/${sliced.tiles.length}…`,
            tilesDone: i,
            progress: 15 + Math.round((i / sliced.tiles.length) * 70),
          });
          try {
            const result = await runTileWithRetry(
              async (input) => callTile({ data: input }),
              t.dataUrl,
              tilePrompt,
              tileModel,
              (ms, attempt) => {
                updateNode(upNodeId, {
                  tileStatus: `Rate limit — retry ubin ${i + 1} dalam ${Math.round(ms / 1000)}s (attempt ${attempt})`,
                });
              },
            );
            enhanced.push({ ...t, dataUrl: result.image });
            totalCredits += estimateCredits(tileModel);
          } catch (e) {
            // Kegagalan permanen di satu ubin: gunakan ubin asli agar sambungan tetap terbentuk.
            enhanced.push(t);
            console.warn(`Tile ${i + 1} fallback ke sumber:`, e);
          }
        }

        updateNode(upNodeId, { tileStatus: "Menyatukan ubin (feather blending)…", tilesDone: sliced.tiles.length, progress: 90 });
        let stitched: string;
        try {
          stitched = await stitchTiles(enhanced, grid, overlap, targetW, targetH);
        } catch (e) {
          updateNode(upNodeId, { status: "error", error: e instanceof Error ? e.message : "Stitch gagal" });
          return;
        }

        // Optional Pro pass on the full stitched canvas for global harmonization.
        let finalImage = stitched;
        if (model === "google/gemini-3-pro-image") {
          updateNode(upNodeId, { tileStatus: "Penyelarasan akhir (Pro)…", progress: 95 });
          try {
            const proRes = await callRender({
              data: {
                sketchBase64: stitched,
                referenceBase64: null,
                prompt: `${prompt} Ini adalah komposit tiled — hanya lakukan penyelarasan global (color grading, kontras, sambungan) tanpa mengubah geometri.`,
                renderType: "exterior",
                accuracy: 10,
                consistency: 10,
                model,
              },
            });
            if (proRes.ok && proRes.resultUrl) {
              try {
                const r = await fetch(proRes.resultUrl);
                const blob = await r.blob();
                finalImage = await new Promise<string>((resolve, reject) => {
                  const fr = new FileReader();
                  fr.onload = () => resolve(fr.result as string);
                  fr.onerror = () => reject(fr.error);
                  fr.readAsDataURL(blob);
                });
                totalCredits += estimateCredits(model);
              } catch {
                finalImage = proRes.resultUrl;
              }
            }
          } catch {
            /* keep stitched image */
          }
        }

        // Enforce exact target dimensions.
        try {
          finalImage = await upscaleDataUrl(finalImage, longEdgePx);
        } catch {
          /* keep as-is */
        }

        updateNode(upNodeId, {
          resultImage: finalImage,
          status: "done",
          progress: 100,
          credits: totalCredits,
          model: tileModel,
          tileStatus: `${sliced.tiles.length} ubin tersambung mulus`,
        });
        toast.success(`Tiled upscale ${resolution} selesai (${sliced.tiles.length} ubin)`);
        return;
      }
      // ============ End tiled branch ============



      try {
        const res = await callRender({
          data: {
            sketchBase64: sourceImage,
            referenceBase64: null,
            prompt,
            renderType: "exterior",
            accuracy: 10,
            consistency: 10,
            model,
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
          // Enforce actual pixel dimensions on the long edge.
          const targetLong = longEdgePx;
          try {
            dataUrl = await upscaleDataUrl(dataUrl, targetLong);
          } catch {
            /* keep AI output as-is if resize fails */
          }
          updateNode(upNodeId, {
            resultImage: dataUrl,
            status: "done",
            progress: 100,
            credits: estimateCredits(res.modelUsed),
            model: res.modelUsed,
          });
          if (res.fallbackFrom) {
            toast.info("Model pilihan belum tersedia; upscale dilanjutkan dengan Gemini 2.5 Flash Image");
          }
          toast.success(`Upscale ${resolution} selesai`);

        } else {
          updateNode(upNodeId, {
            status: "error",
            error: res.ok ? "Tidak ada URL" : res.error,
          });
        }
      } catch (e) {
        updateNode(upNodeId, {
          status: "error",
          error: e instanceof Error ? e.message : "Error",
        });
      }
    },
    [graph, callRender, updateNode],
  );
}

// ---------- Preset builder ----------

function buildPreset(sketches: SketchLite[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  // Node width ~280px. Beri jarak antar-kolom & antar-baris agar tidak
  // saling tumpang tindih walau isi node memanjang.
  const colX = [0, 380, 760, 1140];
  const rowH = 560;
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
        position: { x: colX[0], y },
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
        position: { x: colX[1], y },
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
        position: { x: colX[2], y },
        data: { kind: "render", status: "idle", progress: 0 } satisfies RenderNodeData,
      },
      {
        id: outputId,
        type: "output",
        position: { x: colX[3], y },
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

  // Auto-provision the default 4-node row per sketch that ALREADY has
  // screenshots — only when the canvas is empty. Prevents an empty canvas
  // on first visit while shots exist, and avoids clobbering user edits.
  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (!loaded || didAutoLoad.current) return;
    if (graph.nodes.length > 0) { didAutoLoad.current = true; return; }
    const withShots = sketchesWithShots(loadSketches());
    if (withShots.length === 0) return;
    didAutoLoad.current = true;
    const { nodes, edges } = buildPreset(withShots);
    setGraph({ nodes, edges, outputs: graph.outputs });
  }, [loaded, graph.nodes.length, graph.outputs, setGraph]);


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

  // Spawn node from dropdown. For input/output, an optional sketchId picks
  // the sketch to bind — otherwise the first sketch is used.
  const spawnNode = (
    kind:
      | "input"
      | "prompt"
      | "render"
      | "output"
      | "reference"
      | "edit"
      | "upload"
      | "upscale"
      | "singleOutput",
    sketchId?: string,
  ) => {
    const anchor = { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 };
    const uid = crypto.randomUUID().slice(0, 8);
    const sk = sketchId ? sketches.find((s) => s.id === sketchId) ?? sketches[0] : sketches[0];
    if ((kind === "input" || kind === "output" || kind === "singleOutput") && !sk) {
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
    } else if (kind === "upload") {
      node = {
        id: `upload-${uid}`,
        type: "upload",
        position: anchor,
        data: {
          kind: "upload",
          sketchId: `upload-${uid}`,
          sketchTitle: "Unggahan Eksternal",
          selectedShotId: null,
          uploads: [],
        } satisfies UploadNodeData,
      };
    } else if (kind === "upscale") {
      node = {
        id: `upscale-${uid}`,
        type: "upscale",
        position: anchor,
        data: {
          kind: "upscale",
          model: "google/gemini-2.5-flash-image",
          resolution: "2K",
          status: "idle",
          progress: 0,
        } satisfies UpscaleNodeData,
      };
    } else if (kind === "singleOutput" && sk) {
      node = {
        id: `single-${uid}`,
        type: "output",
        position: anchor,
        data: {
          kind: "output",
          sketchId: sk.id,
          sketchTitle: sk.title,
          geometryConsistency: 80,
          singleOutput: true,
          selectedShotId: null,
          standaloneStatus: "idle",
          standaloneImage: null,
        } satisfies OutputNodeData,
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

  const runUpscale = useUpscaleExecute();

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
      upload: UploadNode,
      upscale: (props: NodeProps) => <UpscaleNode {...props} onRun={runUpscale} />,
    }),
    [runUpscale],
  );

  const loadPreset = () => {
    const fresh = loadSketches();
    setSketches(fresh);
    const withShots = sketchesWithShots(fresh);
    if (withShots.length === 0) {
      toast.error("Belum ada screenshot 3D. Ambil screenshot di halaman 3D Model / Master Plan dahulu.");
      return;
    }
    // Preserve "upload" nodes and any node/edge reachable from them (both directions).
    const keepIds = new Set<string>();
    for (const n of graph.nodes) {
      if (n.type === "upload" || n.type === "upscale") { keepIds.add(n.id); continue; }
      if (n.type === "output" && (n.data as OutputNodeData).singleOutput) keepIds.add(n.id);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of graph.edges) {
        if (keepIds.has(e.source) && !keepIds.has(e.target)) { keepIds.add(e.target); changed = true; }
        if (keepIds.has(e.target) && !keepIds.has(e.source)) { keepIds.add(e.source); changed = true; }
      }
    }
    const keptNodes = graph.nodes.filter((n) => keepIds.has(n.id));
    const keptEdges = graph.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target));
    const { nodes: presetNodes, edges: presetEdges } = buildPreset(withShots);
    // Offset preset nodes below kept upload chains to avoid overlap
    const maxY = keptNodes.reduce((m, n) => Math.max(m, (n.position?.y ?? 0) + 200), 0);
    const shiftedPreset = keptNodes.length
      ? presetNodes.map((n) => ({ ...n, position: { x: n.position.x, y: n.position.y + maxY } }))
      : presetNodes;
    setGraph({
      nodes: [...keptNodes, ...shiftedPreset],
      edges: [...keptEdges, ...presetEdges],
      outputs: graph.outputs,
    });
    toast.success(
      keptNodes.length
        ? `Preset dimuat: ${withShots.length} sketsa (${keptNodes.filter((n) => n.type === "upload").length} unggah input dipertahankan)`
        : `Preset dimuat: ${withShots.length} sketsa`,
    );
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
              <DropdownMenuLabel>Jenis Node</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => spawnNode("input")}>
                <ImageIcon className="mr-2 h-3 w-3 text-sky-500" /> 1 · 3D Input
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("upload")}>
                <Upload className="mr-2 h-3 w-3 text-indigo-500" /> 1b · Unggah Input (Eksternal)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("prompt")}>
                <Wand2 className="mr-2 h-3 w-3 text-violet-500" /> 2 · Prompt & Style
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("render")}>
                <Sparkles className="mr-2 h-3 w-3 text-amber-500" /> 3 · AI Render Engine
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("output")}>
                <Layers className="mr-2 h-3 w-3 text-emerald-500" /> 4 · Multi-Angle Output
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("singleOutput")}>
                <Layers className="mr-2 h-3 w-3 text-emerald-500" /> 4b · Single Output
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("upscale")}>
                <Sparkles className="mr-2 h-3 w-3 text-fuchsia-500" /> 5 · Upscale AI (2K/4K/8K)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Node Lanjutan</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => spawnNode("reference")}>
                <Palette className="mr-2 h-3 w-3 text-pink-500" /> Referensi Style
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => spawnNode("edit")}>
                <Pencil className="mr-2 h-3 w-3 text-cyan-500" /> Sketsa Perbaikan (via anotasi)
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
                  case "upload":
                    return "#6366f1";
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
