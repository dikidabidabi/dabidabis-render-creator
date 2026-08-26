import {
  Link,
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogoDabidabi } from "@/components/logo";
import { ProjectHydrationGate } from "@/components/project-hydration-gate";
import { PrivateRouteGate } from "@/components/private-route-gate";

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
        href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Sora:wght@400;500;600;700;800&family=Manrope:wght@300;400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;600;700&family=Archivo:wght@400;500;600;700;800&family=Barlow:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Cormorant+Garamond:wght@400;500;600;700&display=swap",
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

const PROJECT_LINKS = [
  { to: "/studio", label: "Studio" },
  { to: "/masterplan", label: "Master Plan" },
  { to: "/sketch", label: "Sketsa" },
  { to: "/tabulasi", label: "Tabulasi" },
  { to: "/narasi", label: "Narasi" },
  { to: "/presentasi", label: "Presentasi" },
  { to: "/model3d", label: "Model 3D" },
] as const;

const linkClass =
  "text-sm text-muted-foreground transition-colors hover:text-foreground";

function NotifDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-3 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-ember px-1 text-[10px] font-bold leading-none text-white shadow">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Header() {
  const { user, signOut } = useAuth();
  const { unreadMessages, feedUpdates } = useNotifications();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inProject =
    pathname === "/project" ||
    PROJECT_LINKS.some((l) => pathname === l.to || pathname.startsWith(`${l.to}/`));

  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ember shadow-lg">
            <LogoDabidabi size={22} className="text-white" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight text-ember">Dabidabi's</span>
        </Link>
        <nav className="flex items-center gap-3 sm:gap-5">
          {user ? (
            <>
              <Link
                to="/feed"
                className={`relative ${linkClass}`}
                activeProps={{ className: "text-foreground font-medium relative" }}
              >
                Forum Feed
                <NotifDot count={feedUpdates} />
              </Link>
              <Link
                to="/pesan"
                className={`relative ${linkClass}`}
                activeProps={{ className: "text-foreground font-medium relative" }}
              >
                Pesan
                <NotifDot count={unreadMessages} />
              </Link>
              <Link to="/gallery" className={linkClass} activeProps={{ className: "text-foreground font-medium" }}>
                Galeri
              </Link>
              <Link
                to="/project"
                className={`${linkClass} ${inProject ? "font-medium text-foreground" : ""}`}
              >
                Project
              </Link>
              <Link to="/akun" className={linkClass} activeProps={{ className: "text-foreground font-medium" }}>
                Akun
              </Link>

              <Button variant="ghost" size="sm" onClick={() => signOut()}>
                Keluar
              </Button>
            </>
          ) : (
            <>
              <Link to="/login" className={linkClass}>
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

      {user && inProject && (
        <div className="border-t border-border/40 bg-surface/40">
          <div className="mx-auto flex max-w-7xl items-center gap-4 overflow-x-auto px-4 py-2 sm:px-6">
            {PROJECT_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "text-ember font-semibold" }}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}


function RootComponent() {
  return (
    <AuthProvider>
      <ProjectHydrationGate>
        <div className="grain min-h-screen">
          <Header />
          <PrivateRouteGate>
            <Outlet />
          </PrivateRouteGate>
          <Toaster theme="light" position="top-center" richColors />
        </div>
      </ProjectHydrationGate>
    </AuthProvider>
  );
}
