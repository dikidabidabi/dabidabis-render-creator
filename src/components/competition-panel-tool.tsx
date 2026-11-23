// Alat "Panel Arsitektur" di halaman Sketsa: ceklis tampil di Presentasi,
// pilihan kertas, tujuh panel (konten bawaan dari proyek), editor layout,
// konten dan teks penjelasan, sugesti, dan unduhan PSD A1/A2.
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, LayoutTemplate, Lightbulb, Plus, RotateCcw, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PANEL_SETTINGS, PANEL_DEFS, PANEL_KEYS, PANEL_LAYOUTS, applyPanelSuggestion, panelContentCatalog, panelIncluded,
  panelArrangement, panelItems, panelPageGeometry, panelSuggestions, panelTexts, panelTitle,
  type CompetitionPanelConfig, type CompetitionPanelSettings, type PanelCatalogExtras, type PanelContentItem, type PanelKey,
  type PanelLayout, type PanelOrientation, type PanelPaper, type PanelSourceSketch,
} from "@/lib/competition-panels";

type ToolSketch = PanelSourceSketch & { id: string; competitionPanels?: CompetitionPanelSettings | undefined };
type ConfigPatch = { [K in keyof CompetitionPanelConfig]?: CompetitionPanelConfig[K] | undefined };

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

/** Narasi, render perspektif dan moodboard sketsa ini (dipakai untuk isi bawaan). */
function useProjectExtras(sketchId: string): PanelCatalogExtras {
  const [extras, setExtras] = useState<PanelCatalogExtras>({});
  useEffect(() => {
    const load = () => {
      const narasiRaw = readJson("dabidabis_narasi_v1")[sketchId];
      const perspRaw = readJson("dabidabis_perspektif_v1")[sketchId];
      const mood = readJson("dabidabis_moodboard_v1")[sketchId] as { image?: unknown } | undefined;
      const narasi = Array.isArray(narasiRaw) && narasiRaw.length > 0
        ? narasiRaw.map((n: { id?: unknown; text?: unknown }, i) => ({ id: String(n?.id ?? i), text: typeof n?.text === "string" ? n.text : "" }))
        : [{ id: `default-${sketchId}`, text: "" }];
      const perspektif = Array.isArray(perspRaw)
        ? perspRaw.filter((p: { image?: unknown }) => typeof p?.image === "string" && p.image).map((p: { id?: unknown; title?: unknown }) => ({ id: String(p?.id ?? ""), title: typeof p?.title === "string" ? p.title : "" }))
        : [];
      setExtras({ narasi, perspektif, hasMoodboard: typeof mood?.image === "string" && !!mood.image });
    };
    load();
    window.addEventListener("storage", load);
    window.addEventListener("focus", load);
    return () => { window.removeEventListener("storage", load); window.removeEventListener("focus", load); };
  }, [sketchId]);
  return extras;
}

/** Skema mini layout: kotak gambar bernomor dan kotak teks. */
export function PanelLayoutThumb({ layout, orientation, width = 72, active }: { layout: PanelLayout; orientation: PanelOrientation; width?: number; active?: boolean }) {
  const h = orientation === "portrait" ? width * Math.SQRT2 : width / Math.SQRT2;
  const g = panelPageGeometry(layout, width, h);
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true" className={cn("rounded-sm border bg-background", active ? "border-primary" : "border-border")}>
      <rect x={g.header.x} y={g.header.y + g.header.h * 0.4} width={g.header.w * 0.5} height={Math.max(1.5, g.header.h * 0.3)} className="fill-foreground/70" />
      {g.slots.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} className="fill-muted stroke-muted-foreground/40" strokeWidth={0.5} />
          {width >= 60 && <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 3} textAnchor="middle" fontSize={Math.max(6, Math.min(10, b.h * 0.4))} className="fill-muted-foreground">{i + 1}</text>}
        </g>
      ))}
      {g.texts.map((b, i) => <rect key={`t${i}`} x={b.x} y={b.y} width={b.w} height={b.h} className="fill-primary/25 stroke-primary/60" strokeWidth={0.5} />)}
    </svg>
  );
}

export function CompetitionPanelTool({ sketch, onChange, onDownload }: {
  sketch: ToolSketch;
  onChange: (next: CompetitionPanelSettings) => void;
  onDownload: (target: PanelKey | "all", paper: PanelPaper) => void;
}) {
  const settings = sketch.competitionPanels ?? DEFAULT_PANEL_SETTINGS;
  const extras = useProjectExtras(sketch.id);
  const catalog = useMemo(() => panelContentCatalog(sketch, extras), [sketch, extras]);
  const [editing, setEditing] = useState<PanelKey | null>(null);
  const [target, setTarget] = useState<PanelKey | "all">("all");
  const [paper, setPaper] = useState<PanelPaper>(settings.paper);
  useEffect(() => setPaper(settings.paper), [settings.paper]);

  const patch = (p: Partial<CompetitionPanelSettings>) => onChange({ ...settings, ...p });
  const patchPanel = (key: PanelKey, p: ConfigPatch) => {
    const cur = settings.panels[key] ?? {};
    const merged: ConfigPatch = { ...cur, ...p };
    for (const k of Object.keys(merged) as Array<keyof CompetitionPanelConfig>) if (merged[k] === undefined) delete merged[k];
    onChange({ ...settings, panels: { ...settings.panels, [key]: merged as CompetitionPanelConfig } });
  };
  const resetPanel = (key: PanelKey) => {
    const panels = { ...settings.panels };
    const include = panels[key]?.include;
    delete panels[key];
    if (include === false) panels[key] = { include: false };
    onChange({ ...settings, panels });
  };
  const included = PANEL_KEYS.filter((k) => panelIncluded(settings.panels[k]));

  return (
    <div className="space-y-2" data-competition-tool="true">
      <label className="flex items-start gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 text-[11px]">
        <input type="checkbox" className="mt-0.5" checked={settings.enabled} onChange={(e) => patch({ enabled: e.target.checked })} aria-label="Tampilkan slide Panel Arsitektur di Presentasi" />
        <span><span className="font-semibold">Tampilkan di Presentasi</span><br /><span className="text-muted-foreground">Slide panel muncul sebelum slide penutup.</span></span>
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-muted-foreground">Kertas</div>
          <div className="grid grid-cols-2 gap-1">
            {(["A1", "A2"] as const).map((p) => (
              <Button key={p} size="sm" variant={settings.paper === p ? "default" : "outline"} className="h-7 px-1 text-[11px]" onClick={() => patch({ paper: p })}>{p}</Button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-muted-foreground">Orientasi</div>
          <div className="grid grid-cols-2 gap-1">
            {([["portrait", "Potret"], ["landscape", "Lanskap"]] as const).map(([o, label]) => (
              <Button key={o} size="sm" variant={settings.orientation === o ? "default" : "outline"} className="h-7 px-1 text-[11px]" onClick={() => patch({ orientation: o })}>{label}</Button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] font-medium text-muted-foreground">Panel ({included.length}/{PANEL_KEYS.length} dipakai)</div>
        {PANEL_DEFS.map((def) => {
          const cfg = settings.panels[def.key];
          const { items, layout } = panelArrangement(def.key, cfg, catalog, sketch, settings.orientation);
          const on = panelIncluded(cfg);
          const hints = panelSuggestions(def.key, items, layout, catalog, sketch).length;
          return (
            <div key={def.key} className={cn("flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1", !on && "opacity-50")}>
              <input type="checkbox" checked={on} onChange={(e) => patchPanel(def.key, { include: e.target.checked ? undefined : false })} aria-label={`Pakai panel ${def.name}`} />
              <PanelLayoutThumb layout={layout} orientation={settings.orientation} width={18} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold">{panelTitle(def.key, cfg)}</div>
                <div className="truncate text-[10px] text-muted-foreground">{layout.name} · {Math.min(items.length, layout.slots.length)} konten{hints > 0 ? ` · ${hints} sugesti` : ""}</div>
              </div>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditing(def.key)} title={`Atur panel ${def.name}`} aria-label={`Atur panel ${def.name}`}>
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
      <div className="space-y-1.5 rounded-md border border-border bg-background/60 p-1.5">
        <div className="text-[10px] font-semibold">Unduh untuk Photoshop (.psd)</div>
        <select value={target} onChange={(e) => setTarget(e.target.value as PanelKey | "all")} className="h-7 w-full rounded-md border border-border bg-background px-1.5 text-[11px]" aria-label="Panel yang diunduh">
          <option value="all">Semua panel dipakai ({included.length} file, .zip)</option>
          {PANEL_DEFS.map((d) => <option key={d.key} value={d.key}>{panelTitle(d.key, settings.panels[d.key])}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-1">
          {(["A1", "A2"] as const).map((p) => (
            <Button key={p} size="sm" variant={paper === p ? "default" : "outline"} className="h-7 px-1 text-[11px]" onClick={() => setPaper(p)}>{p} · 150 dpi</Button>
          ))}
        </div>
        <Button size="sm" className="h-7 w-full bg-gradient-primary text-[11px] shadow-primary" onClick={() => onDownload(target, paper)} disabled={target === "all" && included.length === 0}>
          <Download className="mr-1 h-3.5 w-3.5" /> Unduh PSD {paper}
        </Button>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Gambar dan teks berada di layer terpisah. Teks dapat diedit di Photoshop; saat dibuka, pilih "Update" bila Photoshop menanyakan pembaruan layer teks.
        </p>
      </div>
      <PanelEditorDialog
        open={editing !== null}
        panelKey={editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onSelect={setEditing}
        settings={settings}
        sketch={sketch}
        catalog={catalog}
        extras={extras}
        patchPanel={patchPanel}
        resetPanel={resetPanel}
      />
    </div>
  );
}

function PanelEditorDialog({ open, panelKey, onOpenChange, onSelect, settings, sketch, catalog, extras, patchPanel, resetPanel }: {
  open: boolean;
  panelKey: PanelKey | null;
  onOpenChange: (o: boolean) => void;
  onSelect: (k: PanelKey) => void;
  settings: CompetitionPanelSettings;
  sketch: ToolSketch;
  catalog: PanelContentItem[];
  extras: PanelCatalogExtras;
  patchPanel: (key: PanelKey, p: ConfigPatch) => void;
  resetPanel: (key: PanelKey) => void;
}) {
  const key = panelKey ?? "konsep";
  const cfg = settings.panels[key];
  const items = panelItems(key, cfg, catalog, sketch);
  const { layout, placements } = panelArrangement(key, cfg, catalog, sketch, settings.orientation);
  const texts = panelTexts(key, cfg, layout, sketch, extras);
  const suggestions = panelSuggestions(key, items, layout, catalog, sketch);
  const labelOf = new Map(catalog.map((c) => [c.token, c.label]));
  const available = catalog.filter((c) => !items.includes(c.token));
  const groups = PANEL_DEFS.map((d) => ({ def: d, list: available.filter((c) => c.group === d.key) })).filter((g) => g.list.length > 0);
  const setItems = (next: string[]) => patchPanel(key, { items: next });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setItems(next);
  };
  const setText = (i: number, field: "title" | "body", value: string) => {
    const base = layout.texts.map((_, k) => cfg?.texts?.[k] ?? null);
    const cur = texts[i] ?? { title: "", body: "" };
    base[i] = { ...cur, [field]: value };
    patchPanel(key, { texts: base });
  };
  const resetText = (i: number) => {
    const base = layout.texts.map((_, k) => cfg?.texts?.[k] ?? null);
    base[i] = null;
    patchPanel(key, { texts: base.some(Boolean) ? base : undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Atur Panel Arsitektur</DialogTitle>
          <DialogDescription>Isi bawaan diambil dari proyek. Ubah layout, konten dan teks penjelasan kapan saja.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Panel">
          {PANEL_DEFS.map((d) => (
            <Button key={d.key} role="tab" aria-selected={d.key === key} size="sm" variant={d.key === key ? "default" : "outline"} className="h-7 text-xs" onClick={() => onSelect(d.key)}>
              {panelTitle(d.key, settings.panels[d.key])}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold">Nama panel</div>
              <Input value={cfg?.title ?? ""} placeholder={PANEL_DEFS.find((d) => d.key === key)?.name} onChange={(e) => patchPanel(key, { title: e.target.value || undefined })} className="h-8 text-sm" />
              <p className="text-[11px] text-muted-foreground">{PANEL_DEFS.find((d) => d.key === key)?.hint}</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs font-semibold"><LayoutTemplate className="h-3.5 w-3.5" /> Layout</div>
              <div className="grid grid-cols-5 gap-1.5">
                <button type="button" onClick={() => patchPanel(key, { layoutId: undefined })} className={cn("flex flex-col items-center gap-1 rounded-md border p-1 text-[10px]", !cfg?.layoutId ? "border-primary bg-primary/10" : "border-border")} title="Layout dipilih otomatis sesuai jumlah dan bentuk konten">
                  <PanelLayoutThumb layout={panelArrangement(key, cfg ? { ...cfg, layoutId: undefined } : undefined, catalog, sketch, settings.orientation).layout} orientation={settings.orientation} width={40} active={!cfg?.layoutId} />
                  Otomatis
                </button>
                {PANEL_LAYOUTS.map((l) => (
                  <button key={l.id} type="button" onClick={() => patchPanel(key, { layoutId: l.id })} className={cn("flex flex-col items-center gap-1 rounded-md border p-1 text-[10px] leading-tight", cfg?.layoutId === l.id ? "border-primary bg-primary/10" : "border-border")} title={l.description}>
                    <PanelLayoutThumb layout={l} orientation={settings.orientation} width={40} active={cfg?.layoutId === l.id} />
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold">Pratinjau susunan</div>
              <p className="text-[11px] text-muted-foreground">Konten pertama mendapat kotak terbesar. Konten lain ditempatkan di kotak yang paling sesuai bentuk gambarnya, lalu digambar ulang mengikuti ukuran kotak.</p>
              <div className="flex gap-3">
                <PanelLayoutThumb layout={layout} orientation={settings.orientation} width={settings.orientation === "portrait" ? 120 : 170} active />
                <ol className="min-w-0 flex-1 space-y-0.5 text-[11px]">
                  {layout.slots.map((_, i) => {
                    const token = placements.find((p) => p.slot === i)?.token;
                    return <li key={i} className={cn("truncate", !token && "text-muted-foreground")}>{i + 1}. {token ? labelOf.get(token) ?? token : "Kosong"}</li>;
                  })}
                  {items.length > layout.slots.length && <li className="text-destructive">+{items.length - layout.slots.length} konten tidak muat</li>}
                </ol>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold">Konten panel</div>
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => resetPanel(key)} title="Kembalikan konten, layout dan teks bawaan">
                  <RotateCcw className="h-3 w-3" /> Bawaan proyek
                </Button>
              </div>
              <ul className="space-y-1">
                {items.map((t, i) => (
                  <li key={t} className={cn("flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs", i >= layout.slots.length && "opacity-50")}>
                    <span className="w-5 text-muted-foreground">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate">{labelOf.get(t) ?? `${t} (tidak tersedia)`}</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Naikkan"><ArrowUp className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Turunkan"><ArrowDown className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setItems(items.filter((x) => x !== t))} aria-label={`Keluarkan ${labelOf.get(t) ?? t}`}><X className="h-3 w-3" /></Button>
                  </li>
                ))}
                {items.length === 0 && <li className="text-[11px] text-muted-foreground">Belum ada konten.</li>}
              </ul>
              {groups.length > 0 && (
                <select value="" onChange={(e) => { if (e.target.value) setItems([...items, e.target.value]); }} className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs" aria-label="Tambah konten dari proyek">
                  <option value="">+ Tambah konten dari proyek…</option>
                  {groups.map((g) => (
                    <optgroup key={g.def.key} label={g.def.name}>
                      {g.list.map((c) => <option key={c.token} value={c.token}>{c.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>
            {suggestions.length > 0 && (
              <div className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-2" data-panel-suggestions="true">
                <div className="flex items-center gap-1 text-xs font-semibold"><Lightbulb className="h-3.5 w-3.5 text-primary" /> Sugesti</div>
                {suggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="min-w-0 flex-1">{s.message}</span>
                    {s.kind === "add" || s.kind === "remove" ? (
                      <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[10px]" onClick={() => setItems(applyPanelSuggestion(items, s))}>
                        {s.kind === "add" ? <><Plus className="mr-0.5 h-3 w-3" />Masukkan</> : <><X className="mr-0.5 h-3 w-3" />Keluarkan</>}
                      </Button>
                    ) : s.kind === "layout" && s.layoutId ? (
                      <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[10px]" onClick={() => patchPanel(key, { layoutId: s.layoutId })}>Pakai</Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <div className="text-xs font-semibold">Teks penjelasan</div>
              {layout.texts.map((_, i) => {
                const t = texts[i] ?? { title: "", body: "" };
                const edited = !!cfg?.texts?.[i];
                return (
                  <div key={i} className="space-y-1 rounded-md border border-border p-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-medium text-muted-foreground">Kotak teks {i + 1}{edited ? " · diedit" : " · otomatis"}</span>
                      {edited && <Button size="sm" variant="ghost" className="ml-auto h-6 gap-1 px-2 text-[10px]" onClick={() => resetText(i)}><RotateCcw className="h-3 w-3" /> Teks otomatis</Button>}
                    </div>
                    <Input value={t.title} onChange={(e) => setText(i, "title", e.target.value)} className="h-7 text-xs font-semibold" aria-label={`Judul kotak teks ${i + 1}`} />
                    <Textarea value={t.body} onChange={(e) => setText(i, "body", e.target.value)} rows={6} className="text-xs" aria-label={`Isi kotak teks ${i + 1}`} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
