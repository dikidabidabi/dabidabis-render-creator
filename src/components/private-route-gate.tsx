import { Link, useRouterState } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

// Semua halaman karya di dalam "Project" bersifat privat: hanya pemilik akun
// yang sudah masuk dapat membukanya. Yang boleh dibagikan hanya presentasi
// dari judul tertentu (lewat halaman "Presentasi Kiriman").
const PRIVATE_PREFIXES = [
  "/project",
  "/studio",
  "/masterplan",
  "/sketch",
  "/tabulasi",
  "/narasi",
  "/presentasi",
  "/model3d",
] as const;

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function PrivateRouteGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (isPrivatePath(pathname) && !user) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="max-w-md rounded-xl border border-border/60 bg-surface/40 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-ember/15 text-ember">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">
            Halaman privat
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Karya di ruang kerja Project hanya dapat diakses oleh akun pembuatnya. Silakan masuk
            dengan akun Anda untuk melanjutkan.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button asChild className="bg-ember text-white hover:bg-ember/90">
              <Link to="/login">Masuk</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/feed">Forum Feed</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
