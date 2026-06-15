import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Layers, BarChart3, Table as TableIcon, PieChart, Inbox, Wallet, Download, Boxes, Car } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type StructuralGrid,
  computeAllStructuralStats,
  collectGrids,
  levelInRange,
  spansForLevel,
  axisPositions,
  isColumnVisible,
} from "@/lib/structural-grid";
import {
  type ParkingArea,
  type ParkingObstacle,
  generateStalls,
  STALL_AREA_M2,
} from "@/lib/parking";

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
type Level = { id: string; name: string; mdpl: number; opacity: number; typicalCount?: number; typicalHeight?: number };
type Line = { a: Point; b: Point; kind?: string; levelId?: string };
type Sketch = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  scale: string;
  layers: Layer[];
  levels: Level[];
  lines?: Line[];
  kdbPct?: number;
  klbCoef?: number;
  kdhPct?: number;
  ktbPct?: number;
  structuralGrid?: StructuralGrid;
  structuralGridExtras?: StructuralGrid[];
  parkingAreas?: ParkingArea[];
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

function isTaman(name: string) {
  return name.trim().toLowerCase().startsWith("taman");
}

function findMdplZeroLevel<T extends { mdpl: number }>(levels: T[]): T | undefined {
  return levels.find((l) => Math.abs(l.mdpl) < 1e-6);
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

  const handleDownloadExcel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      downloadSketchExcel(sketch, data);
    },
    [sketch, data],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface/60 shadow-sm">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-80"
        >
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{sketch.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              Skala {sketch.scale} · {data.totalLahanM2 > 0 ? `Lahan ${fmt(data.totalLahanM2)} m²` : "Lahan belum ditentukan"} · {sketch.levels.length} lapis
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDownloadExcel}
            className="h-8 gap-1.5 text-xs"
            title="Unduh semua tabel sebagai Excel"
          >
            <Download className="h-3.5 w-3.5" />
            Excel
          </Button>
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? "Tutup" : "Buka"}
            className="rounded p-1 text-muted-foreground hover:bg-surface"
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

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
            <Section title="Komposisi Ruang" icon={<Boxes className="h-4 w-4" />}>
              <KomposisiSection sketch={sketch} />
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
  kdhPct?: number;
  ktbPct?: number;
  kdbLimitM2: number; // KDB target = kdbPct% * lahan
  klbLimitM2: number; // KLB target = klbCoef * lahan
  kdhLimitM2: number; // KDH target = kdhPct% * lahan (min)
  ktbLimitM2: number; // KTB target = ktbPct% * lahan (max)
  kdbRencanaM2: number; // ground floor rooms (level dengan mdpl terendah)
  klbRencanaM2: number; // total ruang * koefisien
  kdhRencanaM2: number; // total "Taman" di level dasar
  ktbRencanaM2: number; // total ruang di LT B1
  jumlahLapis: number;
  ketinggianM: number;
  totalKolom: number;
  volumeBetonM3: number;
  parkingTotal: number;
  parkingAreaTotalM2: number;
  parkingEfficiencyPct: number;
  parkingByLevel: Array<{ levelId: string; levelName: string; count: number }>;
};

function computeStats(sk: Sketch): Stats {
  const layers = sk.layers ?? [];
  const levels = sk.levels ?? [];
  const tipMul: Record<string, number> = {};
  for (const lv of levels) tipMul[lv.id] = Math.max(1, lv.typicalCount ?? 1);
  const mul = (l: Layer) => (l.levelId ? tipMul[l.levelId] ?? 1 : 1);

  const sortedLv = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const groundLevel = findMdplZeroLevel(sortedLv) ?? sortedLv[0];
  const groundIdx = groundLevel ? sortedLv.findIndex((l) => l.id === groundLevel.id) : -1;
  const b1Level = groundIdx > 0 ? sortedLv[groundIdx - 1] : undefined;

  // Lahan = hanya layer "Lahan" di level dasar (mdpl 0)
  const lahan = layers.filter(
    (l) => isLahan(l.name) && groundLevel && l.levelId === groundLevel.id,
  );
  // Ruang utk KDB/KLB: bukan lahan, bukan void, bukan taman
  const ruang = layers.filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name));
  // Taman di level dasar (utk KDH)
  const tamanGround = layers.filter(
    (l) => isTaman(l.name) && groundLevel && l.levelId === groundLevel.id,
  );

  const totalLahanM2 = lahan.reduce((s, l) => s + (l.areaM2 || 0), 0);
  const totalRuangM2 = ruang.reduce((s, l) => s + (l.areaM2 || 0) * mul(l), 0);
  const totalEfektifM2 = ruang.filter((l) => (l.coefficient ?? 1) === 1).reduce((s, l) => s + l.areaM2 * mul(l), 0);
  const totalSaranaM2 = ruang.filter((l) => (l.coefficient ?? 1) === 0).reduce((s, l) => s + l.areaM2 * mul(l), 0);
  const totalSetengahM2 = ruang.filter((l) => (l.coefficient ?? 1) === 0.5).reduce((s, l) => s + l.areaM2 * mul(l), 0);

  const kdbLimitM2 = (sk.kdbPct ?? 0) > 0 && totalLahanM2 > 0 ? (sk.kdbPct! / 100) * totalLahanM2 : 0;
  const klbLimitM2 = (sk.klbCoef ?? 0) > 0 && totalLahanM2 > 0 ? sk.klbCoef! * totalLahanM2 : 0;
  const kdhLimitM2 = (sk.kdhPct ?? 0) > 0 && totalLahanM2 > 0 ? (sk.kdhPct! / 100) * totalLahanM2 : 0;
  const ktbLimitM2 = (sk.ktbPct ?? 0) > 0 && totalLahanM2 > 0 ? (sk.ktbPct! / 100) * totalLahanM2 : 0;

  // KDB Rencana: footprint level dasar (tidak digandakan tipikal)
  const kdbRencanaM2 = groundLevel
    ? ruang.filter((l) => l.levelId === groundLevel.id).reduce((s, l) => s + l.areaM2, 0)
    : 0;
  // KLB Rencana: total ruang * koefisien * tipikal (tanpa taman)
  const klbRencanaM2 = ruang.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1) * mul(l), 0);
  // KDH Rencana: total taman di level dasar
  const kdhRencanaM2 = tamanGround.reduce((s, l) => s + l.areaM2, 0);
  // KTB Rencana: total ruang di LT B1 (tanpa lahan/void/taman)
  const ktbRencanaM2 = b1Level
    ? layers
        .filter((l) => l.levelId === b1Level.id && !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name))
        .reduce((s, l) => s + l.areaM2, 0)
    : 0;

  const jumlahLapis = levels.reduce((s, lv) => s + Math.max(1, lv.typicalCount ?? 1), 0);
  const typicalExtra = levels.reduce((s, lv) => s + (Math.max(1, lv.typicalCount ?? 1) - 1) * (Number.isFinite(Number(lv.typicalHeight)) && Number(lv.typicalHeight) > 0 ? Number(lv.typicalHeight) : 3), 0);
  const ketinggianM =
    (levels.length > 1
      ? Math.max(...levels.map((l) => l.mdpl)) - Math.min(...levels.map((l) => l.mdpl))
      : 0) + typicalExtra;



  const { totalColumns, concreteVolumeM3 } = computeAllStructuralStats(sk.structuralGrid, sk.structuralGridExtras, levels);

  // ===== Parkir =====
  const MINOR_PX = 8, MAJOR_EVERY = 10;
  const SCALE_M: Record<string, number> = { "1:100": 1, "1:200": 2, "1:500": 5, "1:1000": 10 };
  const pxPerMeter = (MINOR_PX * MAJOR_EVERY) / (SCALE_M[sk.scale] ?? 1);
  const allLines: Line[] = sk.lines ?? [];
  const grids = collectGrids(sk.structuralGrid, sk.structuralGridExtras);
  const obstaclesForLevel = (lvId: string | undefined): ParkingObstacle[] => {
    const obs: ParkingObstacle[] = [];
    const wallBufferPx = 0.075 * pxPerMeter;
    for (const ln of allLines) {
      if (lvId && ln.levelId !== lvId) continue;
      if ((ln.kind ?? "straight") !== "straight") continue;
      obs.push({ kind: "wall", a: ln.a, b: ln.b, bufferPx: wallBufferPx });
    }
    const lv = levels.find((l) => l.id === lvId);
    if (!lv) return obs;
    for (const g of grids) {
      if (g.lineOnly) continue;
      if (!levelInRange(g, lv, levels)) continue;
      const { spansX, spansY } = spansForLevel(g, lv.id);
      const halfCol = ((g.colSizeCm / 100) * pxPerMeter) / 2;
      const ang = ((g.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const posX = axisPositions(spansX);
      const posY = axisPositions(spansY);
      for (let j = 0; j < posY.length; j++) {
        for (let i = 0; i < posX.length; i++) {
          if (!isColumnVisible(g, lv.id, i, j, spansX, spansY)) continue;
          const lx = posX[i] * pxPerMeter;
          const ly = posY[j] * pxPerMeter;
          const wx = g.origin.x + lx * cos - ly * sin;
          const wy = g.origin.y + lx * sin + ly * cos;
          const corners = [
            { x: -halfCol, y: -halfCol },
            { x:  halfCol, y: -halfCol },
            { x:  halfCol, y:  halfCol },
            { x: -halfCol, y:  halfCol },
          ].map((c) => ({
            x: wx + c.x * cos - c.y * sin,
            y: wy + c.x * sin + c.y * cos,
          }));
          obs.push({ kind: "polygon", poly: corners });
        }
      }
    }
    return obs;
  };
  const parkingAreas: ParkingArea[] = sk.parkingAreas ?? [];
  const mmRotDeg = Number.isFinite(Number(sk.mmGridRotation)) ? Number(sk.mmGridRotation) : 0;
  const mmRotRad = (mmRotDeg * Math.PI) / 180;
  let parkingTotal = 0;
  let parkingAreaTotalM2 = 0;
  const parkingByLevel = new Map<string, number>();
  for (const area of parkingAreas) {
    const stalls = generateStalls(area, pxPerMeter, mmRotRad, obstaclesForLevel(area.levelId));
    const valid = stalls.filter((s) => s.valid).length;
    parkingTotal += valid;
    // luas polygon area (shoelace)
    const pts = area.pointsLocal ?? [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      acc += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    const areaPx = Math.abs(acc) / 2;
    parkingAreaTotalM2 += areaPx / (pxPerMeter * pxPerMeter);
    if (area.levelId) parkingByLevel.set(area.levelId, (parkingByLevel.get(area.levelId) ?? 0) + valid);
  }
  const parkingEfficiencyPct = parkingAreaTotalM2 > 0
    ? (parkingTotal * STALL_AREA_M2 * 100) / parkingAreaTotalM2
    : 0;

  return {
    totalLahanM2,
    totalRuangM2,
    totalEfektifM2,
    totalSaranaM2,
    totalSetengahM2,
    kdbPct: sk.kdbPct,
    klbCoef: sk.klbCoef,
    kdhPct: sk.kdhPct,
    ktbPct: sk.ktbPct,
    kdbLimitM2,
    klbLimitM2,
    kdhLimitM2,
    ktbLimitM2,
    kdbRencanaM2,
    klbRencanaM2,
    kdhRencanaM2,
    ktbRencanaM2,
    jumlahLapis,
    ketinggianM,
    totalKolom: totalColumns,
    volumeBetonM3: concreteVolumeM3,
    parkingTotal,
    parkingAreaTotalM2,
    parkingEfficiencyPct,
    parkingByLevel: Array.from(parkingByLevel.entries()).map(([levelId, count]) => ({
      levelId,
      levelName: levels.find((l) => l.id === levelId)?.name ?? levelId,
      count,
    })),
  };
}


// ---------- Sections ----------

function RekapSection({ data }: { data: Stats }) {
  const kdbDev = data.kdbLimitM2 - data.kdbRencanaM2; // positive = under limit (hijau)
  const klbDev = data.klbLimitM2 - data.klbRencanaM2;
  // KDH: target adalah minimum — rencana ≥ limit = hijau (invert)
  const kdhDev = data.kdhRencanaM2 - data.kdhLimitM2;
  // KTB: target adalah maksimum — rencana ≤ limit = hijau (sama seperti KDB)
  const ktbDev = data.ktbLimitM2 - data.ktbRencanaM2;
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
      <Row
        label={`KDH${data.kdhPct ? ` (min ${data.kdhPct}%)` : ""}`}
        value={`${fmt(data.kdhLimitM2)} m²`}
        muted={!data.kdhPct}
      />
      <Row label="KDH Rencana" value={`${fmt(data.kdhRencanaM2)} m²`} />
      {data.kdhPct ? <DeviationRow dev={kdhDev} invert /> : null}
      <div className="my-2 h-px bg-border" />
      <Row
        label={`KTB${data.ktbPct ? ` (maks ${data.ktbPct}%)` : ""}`}
        value={`${fmt(data.ktbLimitM2)} m²`}
        muted={!data.ktbPct}
      />
      <Row label="KTB Rencana" value={`${fmt(data.ktbRencanaM2)} m²`} />
      {data.ktbPct ? <DeviationRow dev={ktbDev} /> : null}
      <div className="my-2 h-px bg-border" />
      <Row label="Total Luas Ruang" value={`${fmt(data.totalRuangM2)} m²`} />
      <Row label="Luas Efektif" value={`${fmt(data.totalEfektifM2)} m²`} />
      <Row label="Luas Sarana" value={`${fmt(data.totalSaranaM2)} m²`} />
      {data.totalKolom > 0 && (
        <>
          <div className="my-2 h-px bg-border" />
          <Row label="Modul Struktur — Kolom" value={`${data.totalKolom} titik`} />
          <Row label="Volume Beton Kolom" value={`${fmt(data.volumeBetonM3, 2)} m³`} />
        </>
      )}
      {data.parkingAreaTotalM2 > 0 && (
        <>
          <div className="my-2 h-px bg-border" />
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Car className="h-3.5 w-3.5" /> Parkir Mobil
          </div>
          <Row label="Kapasitas Parkir" value={`${data.parkingTotal} mobil`} />
          <Row label="Luas Area Parkir" value={`${fmt(data.parkingAreaTotalM2)} m²`} />
          <Row label="Rasio Efisiensi Parkir" value={`${fmt(data.parkingEfficiencyPct, 1)} %`} />
          {data.parkingByLevel.length > 1 && data.parkingByLevel.map((pl) => (
            <Row key={pl.levelId} label={`· ${pl.levelName}`} value={`${pl.count} mobil`} />
          ))}
        </>
      )}
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

function DeviationRow({ dev, invert }: { dev: number; invert?: boolean }) {
  // Default: dev = limit - rencana. negative => rencana > limit (kelebihan, merah, +)
  // Invert (KDH): dev = rencana - limit. negative => rencana < limit (kurang, merah, −)
  const good = invert ? dev >= 0 : dev >= 0;
  const exceed = dev < 0;
  const abs = Math.abs(dev);
  const sign = invert
    ? exceed
      ? "−"
      : "+"
    : exceed
      ? "+"
      : "−";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">Deviasi</span>
      <span className={cn("font-mono tabular-nums", good ? "text-emerald-500" : "text-red-500")}>
        {sign}
        {fmt(abs)} m²
      </span>
    </div>
  );
}


function LevelDetailSection({ sketch }: { sketch: Sketch }) {
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name));
  if (levels.length === 0) {
    return <p className="text-xs text-muted-foreground">Belum ada level.</p>;
  }
  return (
    <div className="max-h-[420px] space-y-3 overflow-y-auto pr-2 text-sm">
      {levels.map((lv) => {
        const items = ruang.filter((l) => l.levelId === lv.id);
        const totalAsli = items.reduce((s, l) => s + l.areaM2, 0);
        const totalEfektif = items.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);
        return (
          <div key={lv.id} className="rounded-md border border-border/60">
            <div className="flex items-center justify-between bg-muted/30 px-2 py-1.5 text-xs font-medium">
              <span>{lv.name} · {fmt(lv.mdpl, 1)} Elev</span>
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

// ---------- Excel export ----------

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tableHtml(title: string, headers: string[], rows: (string | number)[][]): string {
  const head = headers
    .map((h) => `<th style="background:#eee;border:1px solid #999;padding:4px;text-align:left;">${escapeXml(h)}</th>`)
    .join("");
  const body = rows
    .map(
      (r) =>
        "<tr>" +
        r
          .map(
            (c) =>
              `<td style="border:1px solid #ccc;padding:4px;${typeof c === "number" ? "text-align:right;mso-number-format:'0.00';" : ""}">${escapeXml(String(c))}</td>`,
          )
          .join("") +
        "</tr>",
    )
    .join("");
  return `<h3>${escapeXml(title)}</h3><table style="border-collapse:collapse;margin-bottom:16px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function downloadSketchExcel(sketch: Sketch, data: Stats) {
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const ruang = (sketch.layers ?? []).filter((l) => !isLahan(l.name));

  const sections: string[] = [];

  // Rekapitulasi
  const rekapRows: (string | number)[][] = [
    ["Luas Lahan (m²)", Number(data.totalLahanM2.toFixed(2))],
    ["Jumlah Lapis", data.jumlahLapis],
    ["Ketinggian (m)", Number(data.ketinggianM.toFixed(2))],
    [`KDB${data.kdbPct ? ` (${data.kdbPct}%)` : ""} — Limit (m²)`, Number(data.kdbLimitM2.toFixed(2))],
    ["KDB Rencana (m²)", Number(data.kdbRencanaM2.toFixed(2))],
    [`KLB${data.klbCoef ? ` (×${data.klbCoef})` : ""} — Limit (m²)`, Number(data.klbLimitM2.toFixed(2))],
    ["KLB Rencana (m²)", Number(data.klbRencanaM2.toFixed(2))],
    [`KDH${data.kdhPct ? ` (min ${data.kdhPct}%)` : ""} — Limit (m²)`, Number(data.kdhLimitM2.toFixed(2))],
    ["KDH Rencana (m²)", Number(data.kdhRencanaM2.toFixed(2))],
    [`KTB${data.ktbPct ? ` (maks ${data.ktbPct}%)` : ""} — Limit (m²)`, Number(data.ktbLimitM2.toFixed(2))],
    ["KTB Rencana (m²)", Number(data.ktbRencanaM2.toFixed(2))],
    ["Total Luas Ruang (m²)", Number(data.totalRuangM2.toFixed(2))],
    ["Luas Efektif (m²)", Number(data.totalEfektifM2.toFixed(2))],
    ["Luas Sarana (m²)", Number(data.totalSaranaM2.toFixed(2))],
    ["Luas Semi (m²)", Number(data.totalSetengahM2.toFixed(2))],
  ];
  if (data.totalKolom > 0) {
    rekapRows.push(["Modul Struktur — Kolom (titik)", data.totalKolom]);
    rekapRows.push(["Volume Beton Kolom (m³)", Number(data.volumeBetonM3.toFixed(2))]);
  }
  sections.push(tableHtml("Rekapitulasi", ["Parameter", "Nilai"], rekapRows));

  // Rincian per Level
  for (const lv of levels) {
    const items = ruang.filter((l) => l.levelId === lv.id);
    if (items.length === 0) continue;
    const rows: (string | number)[][] = items.map((r) => {
      const coef = r.coefficient ?? 1;
      return [r.name, coef, Number(r.areaM2.toFixed(2)), Number((r.areaM2 * coef).toFixed(2))];
    });
    const totalAsli = items.reduce((s, l) => s + l.areaM2, 0);
    const totalEfektif = items.reduce((s, l) => s + l.areaM2 * (l.coefficient ?? 1), 0);
    rows.push(["TOTAL", "", Number(totalAsli.toFixed(2)), Number(totalEfektif.toFixed(2))]);
    sections.push(
      tableHtml(
        `Rincian — ${lv.name} (${fmt(lv.mdpl, 1)} Elev)`,
        ["Ruang", "Koef.", "Luas (m²)", "Efektif (m²)"],
        rows,
      ),
    );
  }

  // Distribusi per Level
  const totalAll = ruang.reduce((s, l) => s + l.areaM2, 0) || 1;
  const distRows: (string | number)[][] = levels.map((lv) => {
    const sum = ruang.filter((r) => r.levelId === lv.id).reduce((s, l) => s + l.areaM2, 0);
    return [lv.name, Number(sum.toFixed(2)), Number(((sum / totalAll) * 100).toFixed(2))];
  });
  sections.push(tableHtml("Distribusi per Level", ["Level", "Luas (m²)", "Persentase (%)"], distRows));

  // Estimasi biaya
  const costMap = loadCostMap();
  const rate = costMap[sketch.id] ?? 0;
  const totalCostM2 = (sketch.layers ?? [])
    .filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name))
    .reduce((s, l) => s + (l.areaM2 || 0), 0);
  const totalCost = totalCostM2 * rate;
  sections.push(
    tableHtml(
      "Estimasi Biaya",
      ["Parameter", "Nilai"],
      [
        ["Total Luas Terhitung (m²)", Number(totalCostM2.toFixed(2))],
        ["Biaya per m² (Rp)", rate],
        ["Estimasi Total (Rp)", Math.round(totalCost)],
        ["Arsitektur 25% (Rp)", Math.round(totalCost * 0.25)],
        ["Struktur 35% (Rp)", Math.round(totalCost * 0.35)],
        ["MEP 40% (Rp)", Math.round(totalCost * 0.4)],
      ],
    ),
  );

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${escapeXml(sketch.title).slice(0, 31)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><h2>${escapeXml(sketch.title)}</h2><p>Skala ${escapeXml(sketch.scale)}</p>${sections.join("")}</body></html>`;

  const blob = new Blob(["\uFEFF" + html], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = sketch.title.replace(/[^a-z0-9\-_ ]/gi, "_").slice(0, 60) || "tabulasi";
  a.href = url;
  a.download = `${safeName}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function InfographicSection({ data, sketch }: { data: Stats; sketch: Sketch }) {
  const total = data.totalRuangM2 || 1;
  const pctEfektif = (data.totalEfektifM2 / total) * 100;
  const pctSarana = (data.totalSaranaM2 / total) * 100;
  const pctSetengah = (data.totalSetengahM2 / total) * 100;

  const kdbUsage = data.kdbLimitM2 > 0 ? (data.kdbRencanaM2 / data.kdbLimitM2) * 100 : 0;
  const klbUsage = data.klbLimitM2 > 0 ? (data.klbRencanaM2 / data.klbLimitM2) * 100 : 0;
  const kdhUsage = data.kdhLimitM2 > 0 ? (data.kdhRencanaM2 / data.kdhLimitM2) * 100 : 0;
  const ktbUsage = data.ktbLimitM2 > 0 ? (data.ktbRencanaM2 / data.ktbLimitM2) * 100 : 0;


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
        <RingStat
          label="KDH"
          value={kdhUsage}
          invert
          caption={data.kdhLimitM2 > 0 ? `${fmt(data.kdhRencanaM2, 0)} / ${fmt(data.kdhLimitM2, 0)} m²` : "Belum diatur"}
        />
        <RingStat
          label="KTB"
          value={ktbUsage}
          caption={data.ktbLimitM2 > 0 ? `${fmt(data.ktbRencanaM2, 0)} / ${fmt(data.ktbLimitM2, 0)} m²` : "Belum diatur"}
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

function RingStat({ label, value, caption, invert }: { label: string; value: number; caption?: string; invert?: boolean }) {
  const over = value > 100;
  const pct = Math.max(0, Math.min(100, value));
  const size = 84;
  const thickness = 6;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  // Default (KDB/KLB/KTB): di bawah limit hijau, mendekati kuning, lewat merah.
  // Invert (KDH): minimal — mencapai/melebihi hijau, di bawah merah.
  const color = invert
    ? value >= 100
      ? "hsl(152 65% 45%)"
      : value >= 70
        ? "hsl(38 92% 55%)"
        : "hsl(0 84% 60%)"
    : over
      ? "hsl(0 84% 60%)"
      : value > 85
        ? "hsl(38 92% 55%)"
        : "hsl(152 65% 45%)";

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

function CostEstimateSection({ sketch }: { sketch: Sketch }) {
  const totalM2 = useMemo(() => {
    return (sketch.layers ?? [])
      .filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name))
      .reduce((s, l) => s + (l.areaM2 || 0), 0);
  }, [sketch]);

  const [rate, setRate] = useState<number>(0);
  const [rateStr, setRateStr] = useState<string>("");

  useEffect(() => {
    const map = loadCostMap();
    const v = map[sketch.id] ?? 0;
    setRate(v);
    setRateStr(v ? String(v) : "");
  }, [sketch.id]);

  const update = useCallback(
    (v: number) => {
      setRate(v);
      const map = loadCostMap();
      if (v > 0) map[sketch.id] = v;
      else delete map[sketch.id];
      saveCostMap(map);
    },
    [sketch.id],
  );

  const total = totalM2 * rate;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Acuan biaya per m² (Rp)</label>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={rateStr}
          placeholder="contoh: 7500000"
          onChange={(e) => {
            setRateStr(e.target.value);
            const n = parseFloat(e.target.value);
            update(Number.isFinite(n) && n >= 0 ? n : 0);
          }}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-2">
        <Row label="Total Luas Terhitung" value={`${fmt(totalM2)} m²`} />
        <Row label="Biaya per m²" value={fmtRp(rate)} />
        <div className="my-1 h-px bg-border" />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estimasi Total</span>
          <span className="font-mono text-base font-semibold tabular-nums">{fmtRp(total)}</span>
        </div>
      </div>
      <div className="space-y-1 rounded-md border border-border/60 bg-background/40 p-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pareto Biaya
        </div>
        {[
          { label: "Arsitektur", pct: 0.25 },
          { label: "Struktur", pct: 0.35 },
          { label: "MEP", pct: 0.40 },
        ].map((p) => (
          <div key={p.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              {p.label} <span className="font-mono">({(p.pct * 100).toFixed(0)}%)</span>
            </span>
            <span className="font-mono tabular-nums">{fmtRp(total * p.pct)}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Tidak termasuk layer "Lahan" dan layer bernama "void".
      </p>
    </div>
  );
}

// ---------- Komposisi Ruang ----------

const KOMPOSISI_PALETTE = [
  "hsl(152 65% 45%)", "hsl(20 85% 55%)", "hsl(220 70% 55%)", "hsl(280 60% 55%)",
  "hsl(38 92% 55%)", "hsl(0 84% 60%)", "hsl(190 75% 45%)", "hsl(100 55% 45%)",
  "hsl(330 70% 55%)", "hsl(45 80% 50%)", "hsl(260 60% 60%)", "hsl(170 60% 40%)",
];

function normalizeRoomName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[._\-/()]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function roomGroupKey(name: string): { key: string; label: string } {
  const norm = normalizeRoomName(name);
  if (!norm) return { key: "lainnya", label: "Lainnya" };
  // Pengelompokan berdasarkan nama PERSIS termasuk angka, sehingga
  // "Unit 1 Htl" dan "Unit 2 Htl" terpisah sebagai dua kelompok.
  const key = norm;
  const label = key.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return { key, label };
}

function KomposisiSection({ sketch }: { sketch: Sketch }) {
  const layers = (sketch.layers ?? []).filter((l) => !isLahan(l.name) && !isVoid(l.name) && !isTaman(l.name));
  const levels = [...(sketch.levels ?? [])].sort((a, b) => a.mdpl - b.mdpl);
  const mul: Record<string, number> = {};
  for (const lv of levels) mul[lv.id] = Math.max(1, Math.round(lv.typicalCount ?? 1));

  type G = { key: string; label: string; count: number; area: number; levelIds: Set<string>; color: string };
  const map = new Map<string, G>();
  for (const l of layers) {
    const { key, label } = roomGroupKey(l.name);
    const k = (l.levelId && mul[l.levelId]) || 1;
    let g = map.get(key);
    if (!g) { g = { key, label, count: 0, area: 0, levelIds: new Set(), color: "#000" }; map.set(key, g); }
    g.count += k;
    g.area += (l.areaM2 || 0) * k;
    if (l.levelId) g.levelIds.add(l.levelId);
  }
  const groups = [...map.values()].sort((a, b) => b.area - a.area);
  groups.forEach((g, i) => { g.color = KOMPOSISI_PALETTE[i % KOMPOSISI_PALETTE.length]; });
  const totalArea = groups.reduce((s, g) => s + g.area, 0);
  const totalCount = groups.reduce((s, g) => s + g.count, 0);

  // Koefisien
  const coefBuckets = [
    { label: "Efektif", coef: 1 },
    { label: "Semi", coef: 0.5 },
    { label: "Sarana", coef: 0 },
  ].map((b) => {
    const items = layers.filter((l) => (l.coefficient ?? 1) === b.coef);
    return {
      ...b,
      count: items.reduce((s, l) => s + ((l.levelId && mul[l.levelId]) || 1), 0),
      area: items.reduce((s, l) => s + (l.areaM2 || 0) * ((l.levelId && mul[l.levelId]) || 1), 0),
    };
  });
  const coefTotal = coefBuckets.reduce((s, b) => s + b.area, 0) || 1;

  // Tipikalitas
  const tipMap = new Map<number, { area: number; count: number; levels: string[] }>();
  for (const lv of levels) {
    const k = Math.max(1, Math.round(lv.typicalCount ?? 1));
    const items = layers.filter((l) => l.levelId === lv.id);
    const e = tipMap.get(k) || { area: 0, count: 0, levels: [] };
    e.area += items.reduce((s, l) => s + (l.areaM2 || 0) * k, 0);
    e.count += items.length * k;
    e.levels.push(lv.name);
    tipMap.set(k, e);
  }
  const tipData = [...tipMap.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({
    k, label: k > 1 ? `Tipikal ×${k}` : "Non-tipikal", ...v,
  }));

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-3">
        <DonutMulti
          size={110}
          thickness={9}
          segments={groups.map((g) => ({ label: g.label, value: (g.area / (totalArea || 1)) * 100, color: g.color }))}
          centerValue={`${groups.length}`}
          centerLabel="kelompok"
        />
        <div className="flex-1 text-xs">
          <div className="mb-1 font-medium text-muted-foreground">Ringkasan</div>
          <Row label="Total kelompok" value={`${groups.length}`} />
          <Row label="Total item" value={`${totalCount}`} />
          <Row label="Total luas" value={`${fmt(totalArea)} m²`} />
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Pengelompokkan Ruang</div>
        <div className="max-h-[260px] overflow-y-auto rounded-md border border-border/60">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left font-normal">Kelompok</th>
                <th className="px-2 py-1 text-right font-normal">Jumlah</th>
                <th className="px-2 py-1 text-right font-normal">Luas m²</th>
                <th className="px-2 py-1 text-right font-normal">%</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-t border-border/40">
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: g.color }} />
                      {g.label}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{g.count}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(g.area)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt((g.area / (totalArea || 1)) * 100, 1)}%</td>
                </tr>
              ))}
              <tr className="border-t border-border bg-muted/20 font-medium">
                <td className="px-2 py-1">Total</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{totalCount}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(totalArea)}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Tipe Koefisien</div>
        <div className="space-y-1">
          {coefBuckets.map((b) => (
            <div key={b.label}>
              <div className="mb-0.5 flex items-center justify-between text-xs">
                <span>{b.label} <span className="text-muted-foreground">({b.count} item)</span></span>
                <span className="font-mono tabular-nums text-muted-foreground">{fmt(b.area)} m² · {fmt((b.area / coefTotal) * 100, 1)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (b.area / coefTotal) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Tipikalitas Lantai</div>
        <div className="space-y-1 text-xs">
          {tipData.map((t) => (
            <div key={t.k} className="flex items-center justify-between gap-2 border-t border-border/40 pt-1 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <div className="font-medium">{t.label}</div>
                <div className="truncate text-[10px] text-muted-foreground">{t.levels.join(", ")}</div>
              </div>
              <div className="text-right font-mono tabular-nums text-muted-foreground">
                {t.count} · {fmt(t.area)} m²
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


