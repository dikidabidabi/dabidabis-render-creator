import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Layers, BarChart3, Table as TableIcon, PieChart, Inbox, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/tabulasi")({
  head: () => ({
    meta: [
      { title: "Tabulasi — Dabidabi's" },
      { name: "description", content: "Tabulasi otomatis tiap sketsa: rekap KDB/KLB, rincian ruang per level, dan infografis prosentase fungsi." },
    ],
  }),
  component: TabulasiPage,
});

// Mirror types from sketch.tsx (read-only)
type Point = { x: number; y: number };
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
  layers: Layer[];
  levels: Level[];
  kdbPct?: number;
  klbCoef?: number;
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

function saveCostMap(map: Record<string, number>) {
  try {
    localStorage.setItem(COST_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function fmtRp(n: number) {
  if (!Number.isFinite(n)) return "Rp 0";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function fmt(n: number, d = 2) {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function TabulasiPage() {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tabulasi</h1>
        <p className="text-sm text-muted-foreground">
          Rekap otomatis seluruh sketsa. Terhubung langsung dengan halaman Sketsa — setiap perubahan tersinkron.
        </p>
      </div>

      {loaded && sketches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/40 p-10 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Belum ada sketsa. Buat sketsa baru di halaman Sketsa untuk melihat tabulasinya di sini.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sketches.map((sk) => (
            <TabulasiBox
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

function TabulasiBox({
  sketch,
  open,
  onToggle,
}: {
  sketch: Sketch;
  open: boolean;
  onToggle: () => void;
}) {
  const data = useMemo(() => computeStats(sketch), [sketch]);

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
              Skala {sketch.scale} · {data.totalLahanM2 > 0 ? `Lahan ${fmt(data.totalLahanM2)} m²` : "Lahan belum ditentukan"} · {sketch.levels.length} lapis
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border p-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Section title="Rekapitulasi" icon={<BarChart3 className="h-4 w-4" />}>
              <RekapSection data={data} />
            </Section>
            <Section title="Rincian per Level" icon={<TableIcon className="h-4 w-4" />}>
              <LevelDetailSection sketch={sketch} />
            </Section>
            <Section title="Infografis" icon={<PieChart className="h-4 w-4" />}>
              <InfographicSection data={data} sketch={sketch} />
            </Section>
            <Section title="Estimasi Biaya" icon={<Wallet className="h-4 w-4" />}>
              <CostEstimateSection sketch={sketch} />
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

// ---------- Computations ----------

type Stats = {
  totalLahanM2: number;
  totalRuangM2: number;
  totalEfektifM2: number; // coefficient 1, excluding lahan
  totalSaranaM2: number; // coefficient 0, excluding lahan
  totalSetengahM2: number; // coefficient 0.5
  kdbPct?: number;
  klbCoef?: number;
  kdbLimitM2: number; // KDB target = kdbPct% * lahan
  klbLimitM2: number; // KLB target = klbCoef * lahan
  kdbRencanaM2: number; // ground floor rooms (level dengan mdpl terendah)
  klbRencanaM2: number; // total ruang * koefisien
  jumlahLapis: number;
  ketinggianM: number;
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

  // KDB Rencana: total luas Level 1 (level dengan mdpl terendah) tanpa koefisien
  let kdbRencanaM2 = 0;
  if (levels.length > 0) {
    const ground = [...levels].sort((a, b) => a.mdpl - b.mdpl)[0];
    kdbRencanaM2 = ruang.filter((l) => l.levelId === ground.id).reduce((s, l) => s + l.areaM2, 0);
  }
  // KLB Rencana: total ruang * koefisien
  const klbRencanaM2 = ruang.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);

  const jumlahLapis = levels.length;
  const ketinggianM =
    levels.length > 1
      ? Math.max(...levels.map((l) => l.mdpl)) - Math.min(...levels.map((l) => l.mdpl))
      : 0;

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
  };
}

// ---------- Sections ----------

function RekapSection({ data }: { data: Stats }) {
  const kdbDev = data.kdbLimitM2 - data.kdbRencanaM2; // positive = under limit (hijau)
  const klbDev = data.klbLimitM2 - data.klbRencanaM2;
  return (
    <div className="space-y-2 text-sm">
      <Row label="Luas Lahan" value={`${fmt(data.totalLahanM2)} m²`} />
      <Row label="Jumlah Lapis" value={`${data.jumlahLapis}`} />
      <Row label="Ketinggian" value={`${fmt(data.ketinggianM, 1)} m`} />
      <div className="my-2 h-px bg-border" />
      <Row
        label={`KDB${data.kdbPct ? ` (${data.kdbPct}%)` : ""}`}
        value={`${fmt(data.kdbLimitM2)} m²`}
        muted={!data.kdbPct}
      />
      <Row label="KDB Rencana" value={`${fmt(data.kdbRencanaM2)} m²`} />
      {data.kdbPct ? <DeviationRow dev={kdbDev} /> : null}
      <div className="my-2 h-px bg-border" />
      <Row
        label={`KLB${data.klbCoef ? ` (×${data.klbCoef})` : ""}`}
        value={`${fmt(data.klbLimitM2)} m²`}
        muted={!data.klbCoef}
      />
      <Row label="KLB Rencana" value={`${fmt(data.klbRencanaM2)} m²`} />
      {data.klbCoef ? <DeviationRow dev={klbDev} /> : null}
      <div className="my-2 h-px bg-border" />
      <Row label="Total Luas Ruang" value={`${fmt(data.totalRuangM2)} m²`} />
      <Row label="Luas Efektif" value={`${fmt(data.totalEfektifM2)} m²`} />
      <Row label="Luas Sarana" value={`${fmt(data.totalSaranaM2)} m²`} />
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={cn("text-muted-foreground", muted && "opacity-60")}>{label}</span>
      <span className={cn("font-mono tabular-nums", muted && "opacity-60")}>{value}</span>
    </div>
  );
}

function DeviationRow({ dev }: { dev: number }) {
  // dev = limit - rencana. negative => rencana > limit (kelebihan, merah, +)
  const exceed = dev < 0;
  const abs = Math.abs(dev);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">Deviasi</span>
      <span className={cn("font-mono tabular-nums", exceed ? "text-red-500" : "text-emerald-500")}>
        {exceed ? "+" : "−"}
        {fmt(abs)} m²
      </span>
    </div>
  );
}

function LevelDetailSection({ sketch }: { sketch: Sketch }) {
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name));
  if (levels.length === 0) {
    return <p className="text-xs text-muted-foreground">Belum ada level.</p>;
  }
  return (
    <div className="space-y-3 text-sm">
      {levels.map((lv) => {
        const items = ruang.filter((l) => l.levelId === lv.id);
        const totalAsli = items.reduce((s, l) => s + l.areaM2, 0);
        const totalEfektif = items.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);
        return (
          <div key={lv.id} className="rounded-md border border-border/60">
            <div className="flex items-center justify-between bg-muted/30 px-2 py-1.5 text-xs font-medium">
              <span>{lv.name} · {fmt(lv.mdpl, 1)} mdpl</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {fmt(totalEfektif)} m² efektif
              </span>
            </div>
            {items.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">Belum ada ruang.</div>
            ) : (
              <table className="w-full text-xs">
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
                    <td className="px-2 py-1" colSpan={2}>Total</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(totalAsli)}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(totalEfektif)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InfographicSection({ data, sketch }: { data: Stats; sketch: Sketch }) {
  const total = data.totalRuangM2 || 1;
  const pctEfektif = (data.totalEfektifM2 / total) * 100;
  const pctSarana = (data.totalSaranaM2 / total) * 100;
  const pctSetengah = (data.totalSetengahM2 / total) * 100;

  const kdbUsage = data.kdbLimitM2 > 0 ? (data.kdbRencanaM2 / data.kdbLimitM2) * 100 : 0;
  const klbUsage = data.klbLimitM2 > 0 ? (data.klbRencanaM2 / data.klbLimitM2) * 100 : 0;

  // Per-level distribution
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name));
  const totalAll = ruang.reduce((s, l) => s + l.areaM2, 0) || 1;
  const perLevel = levels.map((lv) => {
    const sum = ruang.filter((r) => r.levelId === lv.id).reduce((s, l) => s + l.areaM2, 0);
    return { name: lv.name, pct: (sum / totalAll) * 100, m2: sum };
  });

  return (
    <div className="space-y-5 text-sm">
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Fungsi Ruang</div>
        <div className="flex items-center gap-4">
          <DonutMulti
            size={120}
            thickness={8}
            segments={[
              { label: "Efektif", value: pctEfektif, color: "hsl(152 65% 45%)" },
              { label: "Semi", value: pctSetengah, color: "hsl(38 92% 55%)" },
              { label: "Sarana", value: pctSarana, color: "hsl(200 85% 55%)" },
            ]}
            centerValue={`${fmt(pctEfektif, 0)}%`}
            centerLabel="Efektif"
          />
          <div className="flex-1 space-y-1.5 text-xs">
            <LegendItem color="bg-emerald-500" label="Efektif" pct={pctEfektif} />
            <LegendItem color="bg-amber-500" label="Semi" pct={pctSetengah} />
            <LegendItem color="bg-sky-500" label="Sarana" pct={pctSarana} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <RingStat
          label="KDB"
          value={kdbUsage}
          caption={data.kdbLimitM2 > 0 ? `${fmt(data.kdbRencanaM2, 0)} / ${fmt(data.kdbLimitM2, 0)} m²` : "Belum diatur"}
        />
        <RingStat
          label="KLB"
          value={klbUsage}
          caption={data.klbLimitM2 > 0 ? `${fmt(data.klbRencanaM2, 0)} / ${fmt(data.klbLimitM2, 0)} m²` : "Belum diatur"}
        />
      </div>

      {perLevel.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Distribusi per Level</div>
          <div className="space-y-1.5">
            {perLevel.map((p) => (
              <div key={p.name}>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span>{p.name}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {fmt(p.m2)} m² · {fmt(p.pct, 1)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, p.pct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", color)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono tabular-nums">{fmt(pct, 1)}%</span>
    </div>
  );
}

function DonutMulti({
  segments,
  size = 120,
  thickness = 8,
  centerValue,
  centerLabel,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
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
        {segments.map((s) => {
          const len = (s.value / total) * c;
          const dash = `${len} ${c - len}`;
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
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

function RingStat({ label, value, caption }: { label: string; value: number; caption?: string }) {
  const over = value > 100;
  const pct = Math.max(0, Math.min(100, value));
  const size = 84;
  const thickness = 6;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = over ? "hsl(0 84% 60%)" : value > 85 ? "hsl(38 92% 55%)" : "hsl(152 65% 45%)";
  return (
    <div className="flex flex-col items-center rounded-lg border border-border/60 bg-background/40 p-2">
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
      {caption && <div className="mt-1 text-center text-[10px] text-muted-foreground">{caption}</div>}
    </div>
  );
}
