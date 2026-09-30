import { Link } from "@tanstack/react-router";

export function TabulasiNavigation({ active }: { active: "tabulasi" | "list-material" }) {
  return (
    <nav aria-label="Sub halaman Tabulasi" className="mb-6 flex gap-6 border-b border-border">
      <Link to="/tabulasi" aria-current={active === "tabulasi" ? "page" : undefined} className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${active === "tabulasi" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>Tabulasi</Link>
      <Link to="/tabulasi/list-material" aria-current={active === "list-material" ? "page" : undefined} className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${active === "list-material" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>List Material</Link>
    </nav>
  );
}