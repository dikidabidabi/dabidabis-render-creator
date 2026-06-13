import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useProjectStore } from "@/store/project-store";

export function ProjectHydrationGate({ children }: { children: React.ReactNode }) {
  const hydrated = useProjectStore((s) => s.hydrated);
  const hydrate = useProjectStore((s) => s.hydrate);
  const error = useProjectStore((s) => s.error);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm">
            {error ? `Gagal memuat proyek: ${error}` : "Memuat data proyek…"}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
