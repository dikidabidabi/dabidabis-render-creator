// Studio store — menyimpan graph node-based per-sketsa dan hasil render multi-angle.
// Hasil disinkron ke PERSPEKTIF_KEY sehingga slide Perspektif di Presentasi
// otomatis menarik gambar terbaru tanpa upload manual.
import { create } from "zustand";
import type { Edge, Node } from "@xyflow/react";

const PERSPEKTIF_KEY = "dabidabis_perspektif_v1";
const STUDIO_KEY = "dabidabis_studio_graphs_v1";

export type RenderAngle = {
  id: string;
  angle: string; // "Angle 1", "Eye level", dst.
  image: string | null; // dataURL
  status: "idle" | "processing" | "done" | "error";
  progress: number; // 0..100
  error?: string;
};

export type SketchGraph = {
  nodes: Node[];
  edges: Edge[];
  outputs: RenderAngle[];
};

type StudioState = {
  loaded: boolean;
  graphs: Record<string, SketchGraph>;
  setGraph: (sketchId: string, graph: SketchGraph) => void;
  updateNode: (sketchId: string, nodeId: string, patch: Record<string, unknown>) => void;
  setOutputs: (sketchId: string, outputs: RenderAngle[]) => void;
  updateOutput: (sketchId: string, angleId: string, patch: Partial<RenderAngle>) => void;
  hydrate: () => void;
  syncToPresentasi: (sketchId: string, sketchTitle: string) => void;
};

function persist(graphs: Record<string, SketchGraph>) {
  try {
    // Simpan tanpa image besar untuk hindari quota — kita simpan outputs.image dataURL
    // tetap karena user mungkin ingin melihat lagi; toleransi quota kegagalan.
    localStorage.setItem(STUDIO_KEY, JSON.stringify(graphs));
  } catch {
    // Fallback: buang gambar output agar node config tetap tersimpan.
    try {
      const slim: Record<string, SketchGraph> = {};
      for (const [k, g] of Object.entries(graphs)) {
        slim[k] = { ...g, outputs: g.outputs.map((o) => ({ ...o, image: null })) };
      }
      localStorage.setItem(STUDIO_KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }
}

export const useStudioStore = create<StudioState>((set, get) => ({
  loaded: false,
  graphs: {},
  hydrate: () => {
    if (get().loaded) return;
    try {
      const raw = localStorage.getItem(STUDIO_KEY);
      const graphs = raw ? (JSON.parse(raw) as Record<string, SketchGraph>) : {};
      set({ graphs, loaded: true });
    } catch {
      set({ graphs: {}, loaded: true });
    }
  },
  setGraph: (sketchId, graph) => {
    const next = { ...get().graphs, [sketchId]: graph };
    persist(next);
    set({ graphs: next });
  },
  updateNode: (sketchId, nodeId, patch) => {
    const g = get().graphs[sketchId];
    if (!g) return;
    const nodes = g.nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n,
    );
    const next = { ...get().graphs, [sketchId]: { ...g, nodes } };
    persist(next);
    set({ graphs: next });
  },
  setOutputs: (sketchId, outputs) => {
    const g = get().graphs[sketchId];
    if (!g) return;
    const next = { ...get().graphs, [sketchId]: { ...g, outputs } };
    persist(next);
    set({ graphs: next });
  },
  updateOutput: (sketchId, angleId, patch) => {
    const g = get().graphs[sketchId];
    if (!g) return;
    const outputs = g.outputs.map((o) => (o.id === angleId ? { ...o, ...patch } : o));
    const next = { ...get().graphs, [sketchId]: { ...g, outputs } };
    persist(next);
    set({ graphs: next });
  },
  syncToPresentasi: (sketchId, sketchTitle) => {
    const g = get().graphs[sketchId];
    if (!g) return;
    try {
      const raw = localStorage.getItem(PERSPEKTIF_KEY);
      const store: Record<string, { id: string; title: string; image: string | null }[]> = raw
        ? JSON.parse(raw)
        : {};
      const items = g.outputs
        .filter((o) => o.image)
        .map((o) => ({
          id: `studio-${o.id}`,
          title: `${sketchTitle} · ${o.angle}`,
          image: o.image,
        }));
      // Gabung: hapus entri studio- lama, tambahkan yang baru.
      const existing = (store[sketchId] ?? []).filter((p) => !p.id.startsWith("studio-"));
      store[sketchId] = [...existing, ...items];
      localStorage.setItem(PERSPEKTIF_KEY, JSON.stringify(store));
    } catch {
      /* ignore */
    }
  },
}));
