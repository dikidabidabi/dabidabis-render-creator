import { Link, Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogoDabidabi } from "@/components/logo";
import { ProjectHydrationGate } from "@/components/project-hydration-gate";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Halaman tidak ditemukan</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Halaman yang Anda cari tidak ada atau telah dipindahkan.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Kembali ke Beranda
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Dabidabi's — AI Architectural Render Studio" },
      {
        name: "description",
        content:
          "Ubah sketsa arsitektur menjadi render fotorealistis dengan AI. Upload sketsa, referensi gaya, dan kontrol akurasi serta konsistensi.",
      },
      { property: "og:title", content: "Dabidabi's — AI Architectural Render Studio" },
      {
        property: "og:description",
        content: "Ubah sketsa arsitektur menjadi render fotorealistis dengan AI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Dabidabi's — AI Architectural Render Studio" },
      { name: "description", content: "AI-powered architectural rendering studio for generating realistic visualizations from sketches and style references." },
      { property: "og:description", content: "AI-powered architectural rendering studio for generating realistic visualizations from sketches and style references." },
      { name: "twitter:description", content: "AI-powered architectural rendering studio for generating realistic visualizations from sketches and style references." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/ae03db73-a228-4c85-a174-607d77c1a097/id-preview-12b6d484--86e7266a-7012-4c9a-bf76-b1a56cbd42ab.lovable.app-1776502237687.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/ae03db73-a228-4c85-a174-607d77c1a097/id-preview-12b6d484--86e7266a-7012-4c9a-bf76-b1a56cbd42ab.lovable.app-1776502237687.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Manrope:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Header() {
  const { user, signOut } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ember shadow-lg">
            <LogoDabidabi size={22} className="text-white" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight text-ember">Dabidabi's</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          {user ? (
            <>
              <Link
                to="/studio"
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                Studio
              </Link>
              <Link
                to="/sketch"
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                Sketsa
              </Link>
              <Link
                to="/tabulasi"
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                Tabulasi
              </Link>
              <Link
                to="/narasi"
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                Narasi
              </Link>
              <Link
                to="/presentasi"
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                Presentasi
              </Link>
              <Link
                to="/model3d"
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                Model 3D
              </Link>
              <Link
                to="/gallery"
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                Galeri
              </Link>
              <Link
                to="/akun"
                className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                Akun
              </Link>
              <Button variant="ghost" size="sm" onClick={() => signOut()}>
                Keluar
              </Button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Masuk
              </Link>
              <Button asChild size="sm" className="bg-ember text-white shadow-lg hover:bg-ember/90">
                <Link to="/login" search={{ mode: "signup" }}>
                  Mulai Render
                </Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <ProjectHydrationGate>
        <div className="grain min-h-screen">
          <Header />
          <Outlet />
          <Toaster theme="light" position="top-center" richColors />
        </div>
      </ProjectHydrationGate>
    </AuthProvider>
  );
}
