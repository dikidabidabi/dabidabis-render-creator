import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { mode?: "signin" | "signup" } => ({
    mode: (search.mode as string) === "signup" ? "signup" : "signin",
  }),
  component: LoginPage,
});

function LoginPage() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const { user, signIn, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"signin" | "signup">(mode ?? "signin");

  useEffect(() => {
    if (user) navigate({ to: "/studio" });
  }, [user, navigate]);

  useEffect(() => setTab(mode ?? "signin"), [mode]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const fn = tab === "signin" ? signIn : signUp;
    const { error } = await fn(email, password);
    setLoading(false);
    if (error) {
      toast.error(error);
    } else if (tab === "signup") {
      toast.success("Akun dibuat. Cek email untuk konfirmasi (atau langsung masuk).");
    } else {
      toast.success("Berhasil masuk.");
    }
  };

  return (
    <main className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ember/10 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-ember shadow-ember">
            <Layers className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {tab === "signin" ? "Masuk ke Dabidabi's" : "Buat akun Dabidabi's"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {tab === "signin"
              ? "Lanjutkan render arsitektur Anda."
              : "Mulai render sketsa pertama Anda dengan AI."}
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-surface/60 p-6 shadow-soft backdrop-blur sm:p-8">
          <div className="mb-6 flex rounded-lg bg-muted p-1">
            {(["signin", "signup"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                  tab === t
                    ? "bg-surface-elevated text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                {t === "signin" ? "Masuk" : "Daftar"}
              </button>
            ))}
          </div>

          <form onSubmit={handle} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="anda@studio.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 6 karakter"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-ember shadow-ember hover:opacity-90"
            >
              {loading ? (
                "Memproses..."
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {tab === "signin" ? "Masuk" : "Daftar"}
                </>
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            ← Kembali ke beranda
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
