import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Image as ImageIcon, Sliders, Layers, CircleDot, PenTool, Box, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";


export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <main className="relative overflow-hidden">
      {/* Hero */}
      <section className="relative px-4 pt-16 pb-24 sm:px-6 sm:pt-24 sm:pb-32">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-ember/10 blur-[120px]" />
        </div>

        <div className="mx-auto max-w-5xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface/60 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5 text-ember" />
            Powered by Gemini Vision AI
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-7xl md:text-8xl"
          >
            Sketsa hari ini,
            <br />
            <span className="text-gradient-primary">render esok hari</span>
            <br />
            jadi <span className="italic font-light">sekarang juga.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mx-auto mt-6 max-w-xl text-sm font-medium uppercase tracking-[0.2em] text-ember sm:text-base"
          >
            Mengembalikan konsepsi di tangan arsitek
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.18 }}
            className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg"
          >
            Studio render arsitektur bertenaga AI. Upload sketsa, lampirkan referensi gaya,
            atur akurasi & konsistensi — dapatkan visualisasi berkualitas portfolio dalam hitungan detik.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Button
              size="lg"
              className="bg-gradient-primary text-base shadow-primary hover:opacity-90"
              onClick={() => navigate({ to: user ? "/studio" : "/login", search: user ? undefined : { mode: "signup" } })}
            >
              {user ? "Buka Studio" : "Mulai Gratis"}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
            {!user && (
              <Button asChild size="lg" variant="ghost" className="text-base">
                <Link to="/login">Sudah punya akun?</Link>
              </Button>
            )}
          </motion.div>
        </div>

        {/* Preview card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mx-auto mt-20 max-w-5xl"
        >
          <div className="relative rounded-2xl border border-border/60 bg-surface/60 p-3 shadow-elevated backdrop-blur sm:p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PreviewTile
                label="Sketsa"
                gradient="from-muted to-surface-elevated"
                content={
                  <svg viewBox="0 0 200 130" className="h-full w-full text-muted-foreground/60">
                    <path
                      d="M20 110 L20 60 L60 30 L140 30 L180 60 L180 110 Z M60 110 L60 75 L100 75 L100 110 M120 110 L120 75 L160 75 L160 110 M70 30 L70 15 L130 15 L130 30"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                }
              />
              <PreviewTile
                label="Render AI"
                gradient="from-ember/30 to-ember-glow/10"
                content={
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="text-center">
                      <Sparkles className="mx-auto h-10 w-10 text-ember" />
                      <p className="mt-2 text-xs text-muted-foreground">Fotorealistis dalam ~20 detik</p>
                    </div>
                  </div>
                }
              />
            </div>
          </div>
        </motion.div>
      </section>

      {/* ICE Workflow */}
      <section className="border-t border-border/40 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-5xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ember/30 bg-ember/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-ember">
              <CircleDot className="h-3.5 w-3.5" />
              Sistem Workflow
            </div>
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              ICE
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-lg text-muted-foreground">
              Integrated Conceptual Environment
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground">
              Kerangka kerja terpadu yang menghubungkan setiap tahap perancangan arsitektur — dari konsep sketsa, tabulasi ruang, narasi spasial, presentasi profesional, hingga model 3D interaktif — dalam satu ekosistem yang koheren dan berkelanjutan.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
          >
            <WorkflowStep
              icon={<PenTool className="h-5 w-5" />}
              step="1"
              title="Sketsa"
              desc="Gambar denah & potongan, atur level, ruang, dan koordinat tapak."
            />
            <WorkflowStep
              icon={<Layers className="h-5 w-5" />}
              step="2"
              title="Tabulasi"
              desc="Hitung luas, program ruang, dan analisis rasionalitas otomatis."
            />
            <WorkflowStep
              icon={<Sparkles className="h-5 w-5" />}
              step="3"
              title="Narasi"
              desc="Hasilkan kisah spasial dengan bantuan AI dari data perancangan."
            />
            <WorkflowStep
              icon={<Presentation className="h-5 w-5" />}
              step="4"
              title="Presentasi"
              desc="Susun slide profesional denah, potongan, dan analisis kawasan."
            />
            <WorkflowStep
              icon={<Box className="h-5 w-5" />}
              step="5"
              title="Model 3D"
              desc="Jelajahi bangunan dalam tampilan tiga dimensi interaktif."
            />
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/40 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Kontrol penuh di tangan arsitek.
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Bukan generator acak — Dabidabi's menjaga proporsi sketsa Anda dan mengikuti referensi gaya yang Anda pilih.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            <FeatureCard
              icon={<ImageIcon className="h-5 w-5" />}
              title="Sketsa + Referensi"
              desc="Unggah sketsa tangan atau CAD beserta gambar referensi material/gaya. AI menggabungkan keduanya."
            />
            <FeatureCard
              icon={<Sliders className="h-5 w-5" />}
              title="Akurasi & Konsistensi"
              desc="Slider untuk seberapa ketat AI mengikuti garis sketsa dan seberapa setia pada gaya referensi."
            />
            <FeatureCard
              icon={<Layers className="h-5 w-5" />}
              title="4 Tipe Render"
              desc="Eksterior fotorealistis, interior, night shot dramatis, atau ilustrasi watercolor artistik."
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-border/40 px-4 py-10 text-center text-xs text-muted-foreground sm:px-6">
        Dabidabi's — AI render studio untuk arsitek modern.
      </footer>
    </main>
  );
}

function PreviewTile({
  label,
  gradient,
  content,
}: {
  label: string;
  gradient: string;
  content: React.ReactNode;
}) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border/60 bg-surface">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
      <div className="relative flex h-full items-center justify-center p-6">{content}</div>
      <div className="absolute left-3 top-3 rounded-md bg-background/70 px-2 py-1 text-[10px] font-medium uppercase tracking-wider backdrop-blur">
        {label}
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-surface/60 p-6 transition-all hover:border-ember/40 hover:shadow-soft">
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-ember/10 text-ember">
        {icon}
      </div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function WorkflowStep({
  icon,
  step,
  title,
  desc,
}: {
  icon: React.ReactNode;
  step: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="group relative rounded-xl border border-border/60 bg-surface/60 p-5 text-left transition-all hover:border-ember/40 hover:shadow-soft">
      <div className="mb-3 flex items-center gap-2">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-ember/10 text-ember">
          {icon}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-ember">{step}</span>
      </div>
      <h4 className="font-display text-sm font-semibold">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}
