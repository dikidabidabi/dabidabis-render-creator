import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, RotateCcw, Save, Sigma, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_FORMULA_SETTINGS,
  FORMULA_GROUPS,
  type FormulaSettings,
  fetchFormulaSettings,
  loadFormulaSettings,
  saveFormulaSettings,
} from "@/lib/formula-settings";

export const Route = createFileRoute("/tabulasi/rumus")({
  head: () => ({
    meta: [
      { title: "Rumus Tabulasi — Dabidabi's" },
      {
        name: "description",
        content:
          "Atur seluruh rumus tabulasi: KDB, KLB, KDH, KTB, dimensi parkir, lot difabel, radius tangga evakuasi, struktur, dan biaya — per akun pengguna.",
      },
      { property: "og:title", content: "Rumus Tabulasi — Dabidabi's" },
      {
        property: "og:description",
        content: "Setiap pengguna dapat mengisi angka rumus tabulasi sesuai regulasi daerahnya masing-masing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RumusPage,
});

function RumusPage() {
  const { user, loading: authLoading } = useAuth();
  const [values, setValues] = useState<FormulaSettings>(DEFAULT_FORMULA_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    setValues(loadFormulaSettings(user?.id ?? null));
    setReady(true);
    if (user?.id) {
      fetchFormulaSettings(user.id).then((remote) => {
        if (remote) setValues(remote);
      });
    }
  }, [authLoading, user?.id]);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(loadFormulaSettings(user?.id ?? null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values, user?.id],
  );

  const setField = (key: keyof FormulaSettings, raw: string) => {
    const n = Number(raw.replace(",", "."));
    setValues((p) => ({ ...p, [key]: Number.isFinite(n) ? n : 0 }));
  };

  const handleSave = async () => {
    setSaving(true);
    const { synced } = await saveFormulaSettings(values, user?.id ?? null);
    setSaving(false);
    toast.success(
      synced
        ? "Rumus tersimpan pada akun Anda."
        : user
          ? "Rumus tersimpan di perangkat ini (sinkronisasi akun gagal)."
          : "Rumus tersimpan di perangkat ini. Masuk untuk menyimpan pada akun.",
    );
  };

  const handleReset = () => {
    setValues({ ...DEFAULT_FORMULA_SETTINGS });
    toast.message("Nilai dikembalikan ke bawaan. Tekan Simpan untuk menerapkan.");
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/tabulasi"
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali ke Tabulasi
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sigma className="h-5 w-5 text-primary" />
            Rumus Tabulasi
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Semua angka acuan yang dipakai aplikasi ini dapat Anda isi sendiri sesuai regulasi setempat.
            Pengaturan tersimpan pada akun Anda dan langsung dipakai di halaman Sketsa, Tabulasi, dan Presentasi.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Nilai bawaan
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={saving || !ready} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Simpan
          </Button>
        </div>
      </div>

      {!user && !authLoading && (
        <div className="mb-4 rounded-lg border border-dashed border-border bg-surface/40 px-4 py-3 text-xs text-muted-foreground">
          Anda belum masuk. Rumus akan disimpan di perangkat ini saja —{" "}
          <Link to="/login" className="font-medium text-foreground underline">
            masuk
          </Link>{" "}
          agar pengaturan mengikuti akun Anda.
        </div>
      )}

      {dirty && (
        <div className="mb-4 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-xs">
          Ada perubahan yang belum disimpan.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {FORMULA_GROUPS.map((g) => (
          <section key={g.id} className="rounded-xl border border-border bg-surface/60 p-4 shadow-sm">
            <h2 className="text-sm font-semibold">{g.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{g.note}</p>
            <div className="mt-3 space-y-3">
              {g.fields.map((f) => (
                <div key={String(f.key)} className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={String(f.key)} className="text-xs font-medium">
                      {f.label}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        id={String(f.key)}
                        type="number"
                        step={f.step ?? 0.1}
                        value={String(values[f.key])}
                        onChange={(e) => setField(f.key, e.target.value)}
                        className="h-8 w-28 text-right font-mono text-xs tabular-nums"
                      />
                      <span className="w-14 text-xs text-muted-foreground">{f.unit}</span>
                    </div>
                  </div>
                  <p className="mt-1.5 font-mono text-[11px] leading-snug text-muted-foreground">{f.formula}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
