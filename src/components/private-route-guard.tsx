// Semua halaman di dalam "Project" bersifat privat: hanya pemilik akun yang
// sudah login boleh membukanya. Guard ini bekerja berdasarkan path sehingga
// tidak ada halaman project yang terlewat.
import { Link, useRouterState } from "@tanstack/react-router";
import { Loader2, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";

const PRIVATE_PREFIXES = [
  "/project",
  "/studio",
  "/masterplan",
  "/sketch",
  "/tabulasi",
  "/narasi",
  "/presentasi",
  "/presentasi-kiriman",
  "/model3d",
  "/akun",
];

export function isPrivatePath(pathname: string) {
  return PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function PrivateRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading } = useAuth();

  if (!isPrivatePath(pathname)) return <>{children}</>;

  if (loading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="max-w-sm rounded-xl border border-border/60 bg-surface/40 p-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-ember/15 text-ember">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold">Halaman privat</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Karya di ruang kerja Project hanya dapat diakses oleh akun pembuatnya. Silakan masuk
            dengan akun Anda.
          </p>
          <Link
            to="/login"
            className="mt-5 inline-flex items-center justify-center rounded-md bg-ember px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ember/90"
          >
            Masuk
          </Link>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
