import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  Box,
  Layers,
  Loader2,
  PenTool,
  Presentation,
  Sliders,
  Sparkles,
  Table2,
  FileText,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/project")({
  component: ProjectPage,
  head: () => ({
    meta: [
      { title: "Project — Ruang Kerja Arsitek Dabidabi's" },
      {
        name: "description",
        content:
          "Ruang kerja privat pemilik akun: studio render AI, master plan, sketsa, tabulasi, narasi, presentasi, dan model 3D.",
      },
      { property: "og:title", content: "Project — Ruang Kerja Arsitek Dabidabi's" },
      {
        property: "og:description",
        content: "Semua alat perancangan Dabidabi's dalam satu ruang kerja privat.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const TOOLS = [
  { to: "/studio", label: "Studio", desc: "Render AI berbasis node", icon: Sparkles },
  { to: "/masterplan", label: "Master Plan", desc: "Tata kawasan & konteks 3D", icon: Layers },
  { to: "/sketch", label: "Sketsa", desc: "Gambar denah & ilustrasi analisa", icon: PenTool },
  { to: "/tabulasi", label: "Tabulasi", desc: "Program ruang, KDB/KLB, parkir", icon: Table2 },
  { to: "/narasi", label: "Narasi", desc: "Naskah konsep desain", icon: FileText },
  { to: "/presentasi", label: "Presentasi", desc: "Slide paparan otomatis", icon: Presentation },
  { to: "/model3d", label: "Model 3D", desc: "Massa 3D & library screenshot", icon: Box },
] as const;

function ProjectPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (!user) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-ember">Akun · Project</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Ruang Kerja Project</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Halaman ini hanya dapat diakses oleh pemilik akun. Pilih alat perancangan untuk
          melanjutkan pekerjaan.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((t, i) => (
          <motion.div
            key={t.to}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.3) }}
          >
            <Link
              to={t.to}
              className="group flex h-full flex-col gap-3 rounded-xl border border-border/60 bg-surface/40 p-5 transition-colors hover:border-ember/60 hover:bg-surface/70"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ember/15 text-ember">
                <t.icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight group-hover:text-ember">
                  {t.label}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>
              </div>
            </Link>
          </motion.div>
        ))}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          <Link
            to="/tabulasi/rumus"
            className="group flex h-full flex-col gap-3 rounded-xl border border-dashed border-border/60 p-5 transition-colors hover:border-ember/60"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight group-hover:text-ember">
                Rumus & Regulasi
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Setelan angka regulasi per akun (KDB, KLB, parkir, tangga).
              </p>
            </div>
          </Link>
        </motion.div>
      </div>
    </main>
  );
}
