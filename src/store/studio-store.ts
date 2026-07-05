// Studio store — satu graph global untuk semua sketsa (satu baris node per sketsa).
// Hasil render tiap OutputNode disinkronkan ke PERSPEKTIF_KEY sehingga slide
// Perspektif di halaman Presentasi otomatis menarik gambar terbaru.
import { create } from "zustand";
import type { Edge, Node } from "@xyflow/react";

const PERSPEKTIF_KEY = "dabidabis_perspektif_v1";
const STUDIO_KEY = "dabidabis_studio_graph_v1";

export type RenderAngle = {
  id: string;
  angle: string;
  image: string | null; // dataURL
  status: "idle" | "processing" | "done" | "error";
  progress: number;
  error?: string;
};

export type StudioGraph = {
  nodes: Node[];
  edges: Edge[];
  outputs: Record<string, RenderAngle[]>; // key: sketchId
};

type StudioState = {
  loaded: boolean;
  graph: StudioGraph;
  setGraph: (g: StudioGraph) => void;
  setNodesEdges: (nodes: Node[], edges: Edge[]) => void;
  updateNode: (nodeId: string, patch: Record<string, unknown>) => void;
  addNode: (node: Node) => void;
  addEdge: (edge: Edge) => void;
  removeNode: (nodeId: string) => void;
  setOutputs: (sketchId: string, outputs: RenderAngle[]) => void;
  updateOutput: (sketchId: string, angleId: string, patch: Partial<RenderAngle>) => void;
  hydrate: () => void;
  syncToPresentasi: (sketchId: string, sketchTitle: string) => void;
};


const EMPTY: StudioGraph = { nodes: [], edges: [], outputs: {} };

function persist(graph: StudioGraph) {
  try {
    localStorage.setItem(STUDIO_KEY, JSON.stringify(graph));
  } catch {
    try {
      const slim: StudioGraph = {
        ...graph,
        outputs: Object.fromEntries(
          Object.entries(graph.outputs).map(([k, list]) => [
            k,
            list.map((o) => ({ ...o, image: null })),
          ]),
        ),
      };
      localStorage.setItem(STUDIO_KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }
}

export const useStudioStore = create<StudioState>((set, get) => ({
  loaded: false,
  graph: EMPTY,
  hydrate: () => {
    if (get().loaded) return;
    try {
      const raw = localStorage.getItem(STUDIO_KEY);
      const graph = raw ? (JSON.parse(raw) as StudioGraph) : EMPTY;
      // pastikan bentuk lengkap
      const safe: StudioGraph = {
        nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
        edges: Array.isArray(graph.edges) ? graph.edges : [],
        outputs: graph.outputs && typeof graph.outputs === "object" ? graph.outputs : {},
      };
      set({ graph: safe, loaded: true });
    } catch {
      set({ graph: EMPTY, loaded: true });
    }
  },
  setGraph: (g) => {
    persist(g);
    set({ graph: g });
  },
  setNodesEdges: (nodes, edges) => {
    const next = { ...get().graph, nodes, edges };
    persist(next);
    set({ graph: next });
  },
  updateNode: (nodeId, patch) => {
    const g = get().graph;
    const nodes = g.nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n,
    );
    const next = { ...g, nodes };
    persist(next);
    set({ graph: next });
  },
  setOutputs: (sketchId, outputs) => {
    const g = get().graph;
    const next = { ...g, outputs: { ...g.outputs, [sketchId]: outputs } };
    persist(next);
    set({ graph: next });
  },
  updateOutput: (sketchId, angleId, patch) => {
    const g = get().graph;
    const list = g.outputs[sketchId] ?? [];
    const outputs = list.map((o) => (o.id === angleId ? { ...o, ...patch } : o));
    const next = { ...g, outputs: { ...g.outputs, [sketchId]: outputs } };
    persist(next);
    set({ graph: next });
  },
  syncToPresentasi: (sketchId, sketchTitle) => {
    const g = get().graph;
    const outs = g.outputs[sketchId] ?? [];
    try {
      const raw = localStorage.getItem(PERSPEKTIF_KEY);
      const store: Record<string, { id: string; title: string; image: string | null }[]> = raw
        ? JSON.parse(raw)
        : {};
      const items = outs
        .filter((o) => o.image)
        .map((o) => ({
          id: `studio-${sketchId}-${o.id}`,
          title: `${sketchTitle} · ${o.angle}`,
          image: o.image,
        }));
      const existing = (store[sketchId] ?? []).filter(
        (p) => !p.id.startsWith(`studio-${sketchId}-`),
      );
      store[sketchId] = [...existing, ...items];
      localStorage.setItem(PERSPEKTIF_KEY, JSON.stringify(store));
    } catch {
      /* ignore */
    }
  },
}));
