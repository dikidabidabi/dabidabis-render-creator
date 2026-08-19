import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { saveAccountSetup } from "@/lib/social.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";


export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { mode?: "signin" | "signup" } => ({
    mode: (search.mode as string) === "signup" ? "signup" : "signin",
  }),
  component: LoginPage,
});

const PERORANGAN_LEVELS = [
  "Mahasiswa",
  "Non Arsitek",
  "Pra Arsitek",
  "Arsitek Madya",
  "Arsitek Senior",
] as const;

const KORPORASI_LEVELS = ["Akun Korporasi", "Arsitek Madya", "Arsitek Senior"] as const;

function LoginPage() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const { user, signIn, signUp } = useAuth();
  const setupFn = useServerFn(saveAccountSetup);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"signin" | "signup">(mode ?? "signin");

  const [accountType, setAccountType] = useState<"perorangan" | "korporasi">("perorangan");
  const [level, setLevel] = useState<string>(PERORANGAN_LEVELS[0]);
  const [corpCode, setCorpCode] = useState("");

  useEffect(() => {
    if (user) navigate({ to: "/feed" });
  }, [user, navigate]);

  useEffect(() => setTab(mode ?? "signin"), [mode]);

  useEffect(() => {
    setLevel(accountType === "perorangan" ? PERORANGAN_LEVELS[0] : KORPORASI_LEVELS[0]);
  }, [accountType]);

  const isCorpAccount = accountType === "korporasi" && level === "Akun Korporasi";
  const needsParentCode = accountType === "korporasi" && !isCorpAccount;

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (accountType === "korporasi" && !corpCode.trim() && tab === "signup") {
      toast.error(
        isCorpAccount
          ? "Isi kode/nama akun korporasi Anda."
          : "Isi akun korporasi yang akan dihubungkan.",
      );
      return;
    }
    setLoading(true);
    if (tab === "signin") {
      const { error } = await signIn(email, password);
      setLoading(false);
      if (error) toast.error(error);
      else toast.success("Berhasil masuk.");
      return;
    }

    const meta = {
      account_type: accountType,
      professional_level: level,
      corporate_code: isCorpAccount ? corpCode.trim() : null,
      corporate_parent_code: needsParentCode ? corpCode.trim() : null,
    } as const;
    const { error, hasSession } = await signUp(email, password, meta);
    if (!error && hasSession) {
      const r = await setupFn({ data: { ...meta } });
      if (!r.ok && r.error) toast.error(r.error);
    }
    setLoading(false);
    if (error) toast.error(error);
    else
      toast.success(
        hasSession
          ? "Akun dibuat dan jenis akun tersimpan."
          : "Akun dibuat. Cek email untuk konfirmasi.",
      );
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
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-primary shadow-primary">
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

            {tab === "signup" && (
              <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="space-y-2">
                  <Label>Masuk sebagai</Label>
                  <div className="flex gap-2">
                    {(["perorangan", "korporasi"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setAccountType(t)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                          accountType === t
                            ? "border-ember/60 bg-ember/10 text-ember"
                            : "border-border/60 text-muted-foreground hover:border-ember/40"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="level">
                    {accountType === "perorangan" ? "Kualifikasi" : "Peran dalam korporasi"}
                  </Label>
                  <select
                    id="level"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-ember/60"
                  >
                    {(accountType === "perorangan" ? PERORANGAN_LEVELS : KORPORASI_LEVELS).map(
                      (l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                {accountType === "korporasi" && (
                  <div className="space-y-2">
                    <Label htmlFor="corp">
                      {isCorpAccount ? "Kode akun korporasi Anda" : "Akun korporasi yang dihubungkan"}
                    </Label>
                    <Input
                      id="corp"
                      value={corpCode}
                      onChange={(e) => setCorpCode(e.target.value)}
                      placeholder={isCorpAccount ? "cth. studio-dabidabi" : "Ketik kode korporasi"}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {isCorpAccount
                        ? "Kode ini dibagikan ke arsitek Anda agar terhubung ke bagan hierarki."
                        : "Bagan hierarki di galeri akan menghubungkan akun Anda dengan korporasi ini."}
                    </p>
                  </div>
                )}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-primary shadow-primary hover:opacity-90"
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
