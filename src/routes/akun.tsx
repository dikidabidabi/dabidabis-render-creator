import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2, CloudUpload, CloudDownload, Download, Upload, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  collectWorkspace,
  restoreWorkspace,
  countSketches,
  snapshotByteSize,
  downloadSnapshotFile,
  type WorkspaceSnapshot,
} from "@/lib/workspace-sync";

export const Route = createFileRoute("/akun")({
  component: AkunPage,
});

const BUCKET = "backups";
const FILE = "workspace.json";

type Meta = { byte_size: number; sketch_count: number; updated_at: string } | null;

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function AkunPage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<Meta>(null);
  const [fetching, setFetching] = useState(true);
  const [busy, setBusy] = useState<null | "backup" | "restore">(null);
  const [localStats, setLocalStats] = useState({ sketches: 0, bytes: 0 });

  const refreshLocal = useCallback(() => {
    const snap = collectWorkspace();
    setLocalStats({ sketches: countSketches(snap), bytes: snapshotByteSize(snap) });
  }, []);

  const refreshMeta = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    const { data, error } = await supabase
      .from("cloud_backups")
      .select("byte_size, sketch_count, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) toast.error(error.message);
    setMeta(data ?? null);
    setFetching(false);
  }, [user]);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
      return;
    }
    if (user) {
      refreshLocal();
      refreshMeta();
    }
  }, [user, loading, navigate, refreshLocal, refreshMeta]);

  const doBackup = async () => {
    if (!user) return;
    setBusy("backup");
    try {
      const snap = collectWorkspace();
      const payload = JSON.stringify(snap);
      const blob = new Blob([payload], { type: "application/json" });
      const path = `${user.id}/${FILE}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { upsert: true, contentType: "application/json" });
      if (upErr) throw upErr;
      const { error: metaErr } = await supabase
        .from("cloud_backups")
        .upsert({
          user_id: user.id,
          byte_size: blob.size,
          sketch_count: countSketches(snap),
          updated_at: new Date().toISOString(),
        });
      if (metaErr) throw metaErr;
      toast.success(`Backup berhasil (${countSketches(snap)} proyek, ${formatBytes(blob.size)})`);
      await refreshMeta();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup gagal");
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    if (!user) return;
    if (
      !confirm(
        "Pulihkan dari Cloud akan MENGGANTI seluruh data proyek di perangkat ini dengan backup terakhir. Lanjutkan?",
      )
    )
      return;
    setBusy("restore");
    try {
      const path = `${user.id}/${FILE}`;
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error) throw error;
      const text = await data.text();
      const snap = JSON.parse(text) as WorkspaceSnapshot;
      const n = restoreWorkspace(snap, { wipe: true });
      refreshLocal();
      toast.success(`Pulih dari Cloud: ${n} entri data dimuat`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore gagal");
    } finally {
      setBusy(null);
    }
  };

  const doDownloadLocal = () => {
    const snap = collectWorkspace();
    downloadSnapshotFile(snap, `dabidabis-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const doDownloadCloud = async () => {
    if (!user) return;
    try {
      const path = `${user.id}/${FILE}`;
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error) throw error;
      const text = await data.text();
      const snap = JSON.parse(text) as WorkspaceSnapshot;
      downloadSnapshotFile(snap, `dabidabis-cloud-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unduh gagal");
    }
  };

  const doImportFile = (file: File) => {
    if (!confirm("Impor file akan MENGGANTI seluruh data proyek di perangkat ini. Lanjutkan?")) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snap = JSON.parse(String(reader.result)) as WorkspaceSnapshot;
        const n = restoreWorkspace(snap, { wipe: true });
        refreshLocal();
        toast.success(`Impor berhasil: ${n} entri dimuat`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "File tidak valid");
      }
    };
    reader.readAsText(file);
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Akun & Sinkronisasi</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Backup proyek Anda ke Cloud agar bisa dilanjutkan di perangkat lain dengan akun yang sama.
        </p>

        <section className="mt-8 rounded-2xl border border-border/60 bg-surface/60 p-5 shadow-soft sm:p-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-ember" />
            <div>
              <div className="text-sm font-medium">{user.email}</div>
              <div className="text-xs text-muted-foreground">Data terikat ke akun ini</div>
            </div>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => signOut()}>
              Keluar
            </Button>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border/60 bg-surface/60 p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Di perangkat ini</div>
            <div className="mt-2 font-display text-2xl font-semibold">{localStats.sketches} proyek</div>
            <div className="text-xs text-muted-foreground">{formatBytes(localStats.bytes)} data lokal</div>
            <Button variant="outline" size="sm" className="mt-4" onClick={refreshLocal}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Hitung ulang
            </Button>
          </div>
          <div className="rounded-2xl border border-border/60 bg-surface/60 p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Backup di Cloud</div>
            {fetching ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Memeriksa…
              </div>
            ) : meta ? (
              <>
                <div className="mt-2 font-display text-2xl font-semibold">{meta.sketch_count} proyek</div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(meta.byte_size)} · Terakhir{" "}
                  {new Date(meta.updated_at).toLocaleString("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="mt-2 font-display text-2xl font-semibold text-muted-foreground">—</div>
                <div className="text-xs text-muted-foreground">Belum ada backup</div>
              </>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button
            onClick={doBackup}
            disabled={busy !== null}
            className="h-12 bg-gradient-ember shadow-ember hover:opacity-90"
          >
            {busy === "backup" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CloudUpload className="mr-2 h-4 w-4" />
            )}
            Backup ke Cloud sekarang
          </Button>
          <Button
            onClick={doRestore}
            disabled={busy !== null || !meta}
            variant="outline"
            className="h-12"
          >
            {busy === "restore" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CloudDownload className="mr-2 h-4 w-4" />
            )}
            Pulihkan dari Cloud
          </Button>
        </section>

        <section className="mt-8 rounded-2xl border border-border/60 bg-surface/40 p-5">
          <h2 className="font-display text-lg font-semibold">Ekspor & Impor file</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Alternatif manual: simpan/baca file .json proyek Anda.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={doDownloadLocal}>
              <Download className="mr-2 h-3.5 w-3.5" /> Unduh data lokal (.json)
            </Button>
            <Button variant="secondary" size="sm" onClick={doDownloadCloud} disabled={!meta}>
              <Download className="mr-2 h-3.5 w-3.5" /> Unduh backup Cloud (.json)
            </Button>
            <label className="inline-flex">
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) doImportFile(f);
                  e.currentTarget.value = "";
                }}
              />
              <span className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-secondary px-3 text-sm font-medium hover:bg-secondary/80">
                <Upload className="mr-2 h-3.5 w-3.5" /> Impor dari file
              </span>
            </label>
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/studio" className="hover:text-foreground">← Kembali ke Studio</Link>
        </p>
      </motion.div>
    </main>
  );
}
