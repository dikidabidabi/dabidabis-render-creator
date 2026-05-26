import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Layers,
  Play,
  Pause,
  Maximize2,
  X,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/presentasi")({
  head: () => ({
    meta: [
      { title: "Presentasi — Dabidabi's" },
      { name: "description", content: "Slide presentasi otomatis tiap sketsa: per-level dan tabulasi." },
    ],
  }),
  component: PresentasiPage,
});

// ---------- Types (mirror sketch.tsx) ----------
type Point = { x: number; y: number };
type LineKind = "straight" | "arc" | "bezier";
type Line = {
  a: Point;
  b: Point;
  kind?: LineKind;
  bulge?: number;
  c1?: Point;
  c2?: Point;
  levelId?: string;
};
type Layer = {
  id: string;
  name: string;
  points: Point[];
  areaM2: number;
  color: string;
  levelId?: string;
  coefficient?: number;
};
type Level = { id: string; name: string; mdpl: number; opacity: number };
type Sketch = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  scale: string;
  lines?: Line[];
  layers: Layer[];
  levels: Level[];
  kdbPct?: number;
  klbCoef?: number;
  fungsi?: string;
};
type StoreShape = { sketches: Sketch[]; openId: string | null };

const STORAGE_KEY = "dabidabis_sketch_v2";
const COST_KEY = "dabidabis_cost_v1";

function isLahan(name: string) {
  return name.trim().toLowerCase().startsWith("lahan");
}
function isVoid(name: string) {
  return name.trim().toLowerCase() === "void";
}
function fmt(n: number, d = 2) {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtRp(n: number) {
  if (!Number.isFinite(n)) return "Rp 0";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}
function loadCostMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COST_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// ---------- Page ----------
function PresentasiPage() {
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setSketches([]);
        return;
      }
      const s = JSON.parse(raw) as StoreShape;
      if (s && Array.isArray(s.sketches)) {
        setSketches(s.sketches as Sketch[]);
        setOpenId((prev) => {
          if (prev && s.sketches.some((x) => x.id === prev)) return prev;
          return s.openId ?? s.sketches[0]?.id ?? null;
        });
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    load();
    setLoaded(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) load();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", load);
    const iv = window.setInterval(load, 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", load);
      window.clearInterval(iv);
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Presentasi</h1>
        <p className="text-sm text-muted-foreground">
          Slide otomatis tiap sketsa — per Level diikuti slide Tabulasi. Tersinkron dengan halaman Sketsa & Tabulasi.
        </p>
      </div>

      {loaded && sketches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/40 p-10 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Belum ada sketsa. Buat sketsa di halaman Sketsa untuk melihat presentasinya di sini.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sketches.map((sk) => (
            <PresentasiBox
              key={sk.id}
              sketch={sk}
              open={openId === sk.id}
              onToggle={() => setOpenId((p) => (p === sk.id ? null : sk.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Sketch Box ----------
function PresentasiBox({
  sketch,
  open,
  onToggle,
}: {
  sketch: Sketch;
  open: boolean;
  onToggle: () => void;
}) {
  const slides = useMemo(() => buildSlides(sketch), [sketch]);
  const [idx, setIdx] = useState(0);
  const [full, setFull] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (idx >= slides.length) setIdx(0);
  }, [slides.length, idx]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % slides.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, [playing, slides.length]);

  const prev = useCallback(() => setIdx((i) => (i - 1 + slides.length) % slides.length), [slides.length]);
  const next = useCallback(() => setIdx((i) => (i + 1) % slides.length), [slides.length]);

  // Keyboard nav when fullscreen
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      } else if (e.key === "Escape") {
        setFull(false);
        setPlaying(false);
      } else if (e.key.toLowerCase() === "p") {
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, next, prev]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface/60 shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{sketch.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {slides.length} slide · {sketch.levels.length} level · Skala {sketch.scale}
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border p-4">
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-lg border border-border bg-background">
              <div className="aspect-[16/9] w-full">
                <SlideView slide={slides[idx]} />
              </div>
              {/* Controls overlay */}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent p-2">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/10" onClick={prev}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/10" onClick={next}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-white hover:bg-white/10"
                    onClick={() => setPlaying((p) => !p)}
                    title={playing ? "Jeda" : "Putar"}
                  >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="text-xs font-medium text-white/90">
                  {idx + 1} / {slides.length} · {slides[idx]?.title}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/10"
                  onClick={() => {
                    setFull(true);
                    setPlaying(true);
                  }}
                  title="Slideshow layar penuh"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Thumbs */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setIdx(i)}
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-1 text-[10px] transition-colors",
                    i === idx
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {i + 1}. {s.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {full && (
        <FullscreenSlideshow
          slides={slides}
          idx={idx}
          setIdx={setIdx}
          playing={playing}
          setPlaying={setPlaying}
          onClose={() => {
            setFull(false);
            setPlaying(false);
          }}
        />
      )}
    </div>
  );
}

function FullscreenSlideshow({
  slides,
  idx,
  setIdx,
  playing,
  setPlaying,
  onClose,
}: {
  slides: Slide[];
  idx: number;
  setIdx: (n: number | ((i: number) => number)) => void;
  playing: boolean;
  setPlaying: (b: boolean | ((p: boolean) => boolean)) => void;
  onClose: () => void;
}) {
  const prev = () => setIdx((i) => (i - 1 + slides.length) % slides.length);
  const next = () => setIdx((i) => (i + 1) % slides.length);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div className="relative h-full max-h-screen w-full">
        <div className="flex h-full w-full items-center justify-center p-6">
          <div className="aspect-[16/9] w-full max-w-[1600px] overflow-hidden rounded-lg border border-white/10 bg-background shadow-2xl">
            <SlideView slide={slides[idx]} large />
          </div>
        </div>
        <div className="absolute right-4 top-4">
          <Button variant="ghost" size="icon" className="h-9 w-9 text-white hover:bg-white/10" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
          <Button variant="ghost" size="icon" className="h-10 w-10 text-white hover:bg-white/10" onClick={prev}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 text-white hover:bg-white/10"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-10 w-10 text-white hover:bg-white/10" onClick={next}>
            <ChevronRight className="h-5 w-5" />
          </Button>
          <div className="ml-3 text-xs text-white/70">
            {idx + 1} / {slides.length} · {slides[idx]?.title}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Slide types ----------
type Slide =
  | {
      kind: "level";
      id: string;
      title: string;
      sketch: Sketch;
      level: Level;
      bounds: Bounds;
    }
  | {
      kind: "rekap";
      id: string;
      title: string;
      sketch: Sketch;
      data: Stats;
    }
  | {
      kind: "rincian";
      id: string;
      title: string;
      sketch: Sketch;
    }
  | {
      kind: "infografis";
      id: string;
      title: string;
      sketch: Sketch;
      data: Stats;
    }
  | {
      kind: "biaya";
      id: string;
      title: string;
      sketch: Sketch;
      data: Stats;
    };

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function computeBounds(sk: Sketch): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of sk.layers ?? []) {
    for (const p of l.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  for (const ln of sk.lines ?? []) {
    for (const p of [ln.a, ln.b]) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  // padding
  const w = maxX - minX, h = maxY - minY;
  const pad = Math.max(w, h, 1) * 0.08;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function buildSlides(sk: Sketch): Slide[] {
  const bounds = computeBounds(sk);
  const levels = [...(sk.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const data = computeStats(sk);
  const out: Slide[] = [];
  for (const lv of levels) {
    out.push({
      kind: "level",
      id: `lvl-${lv.id}`,
      title: lv.name,
      sketch: sk,
      level: lv,
      bounds,
    });
  }
  out.push({ kind: "rekap", id: "rekap", title: "Rekapitulasi", sketch: sk, data });
  out.push({ kind: "rincian", id: "rincian", title: "Rincian per Level", sketch: sk });
  out.push({ kind: "infografis", id: "info", title: "Infografis", sketch: sk, data });
  out.push({ kind: "biaya", id: "biaya", title: "Estimasi Biaya", sketch: sk, data });
  return out;
}

// ---------- Stats ----------
type Stats = {
  totalLahanM2: number;
  totalRuangM2: number;
  totalEfektifM2: number;
  totalSaranaM2: number;
  totalSetengahM2: number;
  kdbPct?: number;
  klbCoef?: number;
  kdbLimitM2: number;
  klbLimitM2: number;
  kdbRencanaM2: number;
  klbRencanaM2: number;
  jumlahLapis: number;
  ketinggianM: number;
  totalTerhitungM2: number; // tanpa lahan & void
};

function computeStats(sk: Sketch): Stats {
  const layers = sk.layers ?? [];
  const levels = sk.levels ?? [];
  const lahan = layers.filter((l) => isLahan(l.name));
  const ruang = layers.filter((l) => !isLahan(l.name));
  const totalLahanM2 = lahan.reduce((s, l) => s + (l.areaM2 || 0), 0);
  const totalRuangM2 = ruang.reduce((s, l) => s + (l.areaM2 || 0), 0);
  const totalEfektifM2 = ruang.filter((l) => (l.coefficient ?? 1) === 1).reduce((s, l) => s + l.areaM2, 0);
  const totalSaranaM2 = ruang.filter((l) => (l.coefficient ?? 1) === 0).reduce((s, l) => s + l.areaM2, 0);
  const totalSetengahM2 = ruang.filter((l) => (l.coefficient ?? 1) === 0.5).reduce((s, l) => s + l.areaM2, 0);
  const kdbLimitM2 = (sk.kdbPct ?? 0) > 0 && totalLahanM2 > 0 ? (sk.kdbPct! / 100) * totalLahanM2 : 0;
  const klbLimitM2 = (sk.klbCoef ?? 0) > 0 && totalLahanM2 > 0 ? sk.klbCoef! * totalLahanM2 : 0;
  let kdbRencanaM2 = 0;
  if (levels.length > 0) {
    const ground = [...levels].sort((a, b) => a.mdpl - b.mdpl)[0];
    kdbRencanaM2 = ruang.filter((l) => l.levelId === ground.id).reduce((s, l) => s + l.areaM2, 0);
  }
  const klbRencanaM2 = ruang.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);
  const jumlahLapis = levels.length;
  const ketinggianM =
    levels.length > 1 ? Math.max(...levels.map((l) => l.mdpl)) - Math.min(...levels.map((l) => l.mdpl)) : 0;
  const totalTerhitungM2 = layers
    .filter((l) => !isLahan(l.name) && !isVoid(l.name))
    .reduce((s, l) => s + (l.areaM2 || 0), 0);
  return {
    totalLahanM2,
    totalRuangM2,
    totalEfektifM2,
    totalSaranaM2,
    totalSetengahM2,
    kdbPct: sk.kdbPct,
    klbCoef: sk.klbCoef,
    kdbLimitM2,
    klbLimitM2,
    kdbRencanaM2,
    klbRencanaM2,
    jumlahLapis,
    ketinggianM,
    totalTerhitungM2,
  };
}

// ---------- Slide Renderer ----------
function SlideView({ slide, large }: { slide?: Slide; large?: boolean }) {
  if (!slide) return null;
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-baseline justify-between border-b border-border/60 bg-background/40 px-4 py-2">
        <div className="truncate text-sm font-semibold">{slide.sketch.title}</div>
        <div className="truncate text-xs text-muted-foreground">{slide.title}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {slide.kind === "level" && <LevelSlide slide={slide} />}
        {slide.kind === "rekap" && <RekapSlide data={slide.data} sketch={slide.sketch} />}
        {slide.kind === "rincian" && <RincianSlide sketch={slide.sketch} />}
        {slide.kind === "infografis" && <InfografisSlide data={slide.data} sketch={slide.sketch} />}
        {slide.kind === "biaya" && <BiayaSlide data={slide.data} sketch={slide.sketch} />}
      </div>
      {large ? null : null}
    </div>
  );
}

// ---- Level slide: SVG render layers + lines for this level ----
function LevelSlide({ slide }: { slide: Extract<Slide, { kind: "level" }> }) {
  const { sketch, level, bounds } = slide;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const layers = (sketch.layers ?? []).filter((l) => l.levelId === level.id);
  const lines = (sketch.lines ?? []).filter((l) => l.levelId === level.id);

  // Render lahan (always visible across all levels) as faint backdrop
  const lahanAll = (sketch.layers ?? []).filter((l) => isLahan(l.name));

  const totalLuas = layers.filter((l) => !isLahan(l.name)).reduce((s, l) => s + l.areaM2, 0);

  return (
    <div className="flex h-full w-full gap-3">
      <div className="relative flex min-w-0 flex-1 items-center justify-center rounded-md border border-border/60 bg-background/30">
        <svg
          viewBox={`${bounds.minX} ${bounds.minY} ${w} ${h}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
        >
          {/* Lahan backdrop */}
          {lahanAll.map((l) => (
            <polygon
              key={`lhn-${l.id}`}
              points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(180,180,180,0.18)"
              stroke="rgba(120,120,120,0.7)"
              strokeWidth={Math.max(w, h) * 0.0015}
              strokeDasharray={`${Math.max(w, h) * 0.006} ${Math.max(w, h) * 0.004}`}
            />
          ))}
          {/* Layers of this level */}
          {layers
            .filter((l) => !isLahan(l.name))
            .map((l) => (
              <g key={l.id}>
                <polygon
                  points={l.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={l.color.replace("ALPHA", "0.35")}
                  stroke={l.color.replace("ALPHA", "0.95")}
                  strokeWidth={Math.max(w, h) * 0.002}
                />
                <text
                  x={centroid(l.points).x}
                  y={centroid(l.points).y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.max(w, h) * 0.018}
                  fill="#0a0a0a"
                  style={{ paintOrder: "stroke", stroke: "rgba(255,255,255,0.75)", strokeWidth: Math.max(w, h) * 0.008 } as React.CSSProperties}
                >
                  {l.name}
                </text>
              </g>
            ))}
          {/* Walls */}
          {lines.map((ln, i) => (
            <path
              key={i}
              d={linePath(ln)}
              stroke="#1a1a1a"
              strokeWidth={Math.max(w, h) * 0.003}
              fill="none"
              strokeLinecap="round"
            />
          ))}
        </svg>
      </div>
      <div className="flex w-48 shrink-0 flex-col gap-2 text-xs">
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Level</div>
          <div className="text-sm font-semibold">{level.name}</div>
          <div className="text-[11px] text-muted-foreground">{fmt(level.mdpl, 1)} mdpl</div>
        </div>
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Jumlah Ruang</div>
          <div className="text-sm font-semibold">{layers.filter((l) => !isLahan(l.name)).length}</div>
        </div>
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Luas</div>
          <div className="text-sm font-semibold">{fmt(totalLuas)} m²</div>
        </div>
        {sketch.fungsi && (
          <div className="rounded-md border border-border/60 bg-background/40 p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Fungsi</div>
            <div className="text-sm font-semibold">{sketch.fungsi}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function centroid(pts: Point[]): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  let x = 0, y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

function linePath(ln: Line): string {
  const kind = ln.kind ?? "straight";
  if (kind === "straight") return `M ${ln.a.x} ${ln.a.y} L ${ln.b.x} ${ln.b.y}`;
  if (kind === "arc") {
    const mid = { x: (ln.a.x + ln.b.x) / 2, y: (ln.a.y + ln.b.y) / 2 };
    const dx = ln.b.x - ln.a.x, dy = ln.b.y - ln.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const bulge = ln.bulge ?? 0;
    const cx = mid.x + 2 * nx * bulge;
    const cy = mid.y + 2 * ny * bulge;
    return `M ${ln.a.x} ${ln.a.y} Q ${cx} ${cy} ${ln.b.x} ${ln.b.y}`;
  }
  const c1 = ln.c1 ?? ln.a;
  const c2 = ln.c2 ?? ln.b;
  return `M ${ln.a.x} ${ln.a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${ln.b.x} ${ln.b.y}`;
}

// ---- Tabulasi slides ----
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function RekapSlide({ data, sketch }: { data: Stats; sketch: Sketch }) {
  return (
    <div className="grid h-full grid-cols-2 gap-3 sm:grid-cols-3">
      <StatTile label="Luas Lahan" value={`${fmt(data.totalLahanM2)} m²`} />
      <StatTile label="Jumlah Lapis" value={`${data.jumlahLapis}`} />
      <StatTile label="Ketinggian" value={`${fmt(data.ketinggianM, 1)} m`} />
      <StatTile
        label={`KDB${data.kdbPct ? ` (${data.kdbPct}%)` : ""}`}
        value={`${fmt(data.kdbRencanaM2)} m²`}
        hint={data.kdbLimitM2 > 0 ? `dari batas ${fmt(data.kdbLimitM2)} m²` : "batas belum diatur"}
      />
      <StatTile
        label={`KLB${data.klbCoef ? ` (×${data.klbCoef})` : ""}`}
        value={`${fmt(data.klbRencanaM2)} m²`}
        hint={data.klbLimitM2 > 0 ? `dari batas ${fmt(data.klbLimitM2)} m²` : "batas belum diatur"}
      />
      <StatTile label="Total Luas Ruang" value={`${fmt(data.totalRuangM2)} m²`} />
      <StatTile label="Luas Efektif" value={`${fmt(data.totalEfektifM2)} m²`} />
      <StatTile label="Luas Sarana" value={`${fmt(data.totalSaranaM2)} m²`} />
      <StatTile label="Fungsi" value={sketch.fungsi ?? "—"} />
    </div>
  );
}

function RincianSlide({ sketch }: { sketch: Sketch }) {
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name));
  return (
    <div className="h-full overflow-auto">
      <div className="space-y-3 text-xs">
        {levels.map((lv) => {
          const items = ruang.filter((l) => l.levelId === lv.id);
          const totalAsli = items.reduce((s, l) => s + l.areaM2, 0);
          const totalEf = items.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);
          return (
            <div key={lv.id} className="rounded-md border border-border/60">
              <div className="flex items-center justify-between bg-muted/30 px-2 py-1.5 text-xs font-medium">
                <span>
                  {lv.name} · {fmt(lv.mdpl, 1)} mdpl
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">{fmt(totalEf)} m² efektif</span>
              </div>
              {items.length === 0 ? (
                <div className="px-2 py-2 text-muted-foreground">Belum ada ruang.</div>
              ) : (
                <table className="w-full">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="px-2 py-1 text-left font-normal">Ruang</th>
                      <th className="px-2 py-1 text-right font-normal">Koef.</th>
                      <th className="px-2 py-1 text-right font-normal">Luas</th>
                      <th className="px-2 py-1 text-right font-normal">Efektif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => {
                      const coef = r.coefficient ?? 1;
                      return (
                        <tr key={r.id} className="border-b border-border/40 last:border-0">
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{coef}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(r.areaM2)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(r.areaM2 * coef)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-muted/20 font-medium">
                      <td className="px-2 py-1" colSpan={2}>
                        Total
                      </td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(totalAsli)}</td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(totalEf)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InfografisSlide({ data, sketch }: { data: Stats; sketch: Sketch }) {
  const total = data.totalRuangM2 || 1;
  const pctEfektif = (data.totalEfektifM2 / total) * 100;
  const pctSarana = (data.totalSaranaM2 / total) * 100;
  const pctSetengah = (data.totalSetengahM2 / total) * 100;
  const kdbUsage = data.kdbLimitM2 > 0 ? (data.kdbRencanaM2 / data.kdbLimitM2) * 100 : 0;
  const klbUsage = data.klbLimitM2 > 0 ? (data.klbRencanaM2 / data.klbLimitM2) * 100 : 0;

  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name));
  const totalAll = ruang.reduce((s, l) => s + l.areaM2, 0) || 1;

  return (
    <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-3">
      <div className="rounded-md border border-border/60 bg-background/40 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fungsi Ruang</div>
        <div className="flex items-center gap-3">
          <Donut
            size={130}
            thickness={10}
            segments={[
              { value: pctEfektif, color: "hsl(152 65% 45%)" },
              { value: pctSetengah, color: "hsl(38 92% 55%)" },
              { value: pctSarana, color: "hsl(200 85% 55%)" },
            ]}
            centerValue={`${fmt(pctEfektif, 0)}%`}
            centerLabel="Efektif"
          />
          <div className="flex-1 space-y-1 text-[11px]">
            <Legend dot="bg-emerald-500" label="Efektif" pct={pctEfektif} />
            <Legend dot="bg-amber-500" label="Semi" pct={pctSetengah} />
            <Legend dot="bg-sky-500" label="Sarana" pct={pctSarana} />
          </div>
        </div>
      </div>
      <div className="rounded-md border border-border/60 bg-background/40 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">KDB / KLB</div>
        <div className="flex h-[calc(100%-1.5rem)] items-center justify-around">
          <Ring value={kdbUsage} label="KDB" />
          <Ring value={klbUsage} label="KLB" />
        </div>
      </div>
      <div className="rounded-md border border-border/60 bg-background/40 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Distribusi per Level
        </div>
        <div className="space-y-1.5">
          {levels.map((lv) => {
            const sum = ruang.filter((r) => r.levelId === lv.id).reduce((s, l) => s + l.areaM2, 0);
            const pct = (sum / totalAll) * 100;
            return (
              <div key={lv.id}>
                <div className="mb-0.5 flex items-center justify-between text-[11px]">
                  <span>{lv.name}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {fmt(sum)} m² · {fmt(pct, 1)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BiayaSlide({ data, sketch }: { data: Stats; sketch: Sketch }) {
  const rate = loadCostMap()[sketch.id] ?? 0;
  const total = data.totalTerhitungM2 * rate;
  return (
    <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-2">
      <div className="space-y-3">
        <StatTile label="Total Luas Terhitung" value={`${fmt(data.totalTerhitungM2)} m²`} hint="tanpa Lahan & Void" />
        <StatTile label="Biaya per m²" value={fmtRp(rate)} hint="diatur di halaman Tabulasi" />
      </div>
      <div className="flex flex-col items-center justify-center rounded-md border border-border/60 bg-background/40 p-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Estimasi Total</div>
        <div className="mt-2 font-mono text-2xl font-bold tabular-nums">{fmtRp(total)}</div>
        {rate <= 0 && (
          <div className="mt-2 text-[11px] text-muted-foreground">Atur biaya per m² di halaman Tabulasi</div>
        )}
      </div>
    </div>
  );
}

// ---- Tiny chart primitives ----
function Donut({
  segments,
  size,
  thickness,
  centerValue,
  centerLabel,
}: {
  segments: { value: number; color: string }[];
  size: number;
  thickness: number;
  centerValue?: string;
  centerLabel?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={thickness} opacity={0.35} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const dash = `${len} ${c - len}`;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">
        {centerValue && <span className="font-mono text-lg font-semibold tabular-nums">{centerValue}</span>}
        {centerLabel && <span className="text-[10px] text-muted-foreground">{centerLabel}</span>}
      </div>
    </div>
  );
}

function Ring({ value, label }: { value: number; label: string }) {
  const over = value > 100;
  const pct = Math.max(0, Math.min(100, value));
  const size = 96;
  const thickness = 8;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = over ? "hsl(0 84% 60%)" : value > 85 ? "hsl(38 92% 55%)" : "hsl(152 65% 45%)";
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={thickness} opacity={0.35} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-tight">
          <span className="font-mono text-sm font-semibold tabular-nums">{fmt(value, 0)}%</span>
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </div>
      </div>
    </div>
  );
}

function Legend({ dot, label, pct }: { dot: string; label: string; pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono tabular-nums">{fmt(pct, 1)}%</span>
    </div>
  );
}
