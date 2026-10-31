import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { setProjectItem } from "@/lib/storage/idb-bridge";
import { readScheduleLibrary, SCHEDULE_LIBRARY_KEY, validateTemplate, type ScheduleTemplate, type LibraryWork } from "@/lib/schedule-library";

export const Route = createFileRoute("/jadwal_/pustaka")({
  component: LibraryPage,
  head: () => ({ meta: [
    { title: "Pustaka Jadwal — Template Pekerjaan | Dabidabi's" },
    { name: "description", content: "Kelola pustaka hierarki pekerjaan, WBS huruf, durasi, dan predecessor untuk jadwal privat Dabidabi's." },
    { property: "og:title", content: "Pustaka Jadwal | Dabidabi's" },
    { property: "og:description", content: "Template pekerjaan bertingkat dengan durasi dan predecessor untuk jadwal proyek." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
});

function LibraryPage() {
  const { user } = useAuth();
  return user ? <LibraryWorkspace key={user.id} /> : null;
}
function blankWork(wbs = "a"): LibraryWork { return { id: crypto.randomUUID(), wbs, title: "", duration: 7, predecessor: "" }; }
function LibraryWorkspace() {
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [draft, setDraft] = useState<ScheduleTemplate | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setTemplates(readScheduleLibrary(localStorage.getItem(SCHEDULE_LIBRARY_KEY))); }, []);
  async function persist(next: ScheduleTemplate[]) {
    setSaving(true);
    try { await setProjectItem(SCHEDULE_LIBRARY_KEY, JSON.stringify(next)); setTemplates(next); return true; }
    catch { toast.error("Pustaka belum tersimpan. Silakan coba lagi."); return false; }
    finally { setSaving(false); }
  }
  function update(id: string, patch: Partial<LibraryWork>) { setDraft((current) => current ? { ...current, works: current.works.map((work) => work.id === id ? { ...work, ...patch } : work) } : null); }
  async function save() {
    if (!draft) return;
    try {
      const clean = validateTemplate(draft);
      if (await persist([...templates.filter((entry) => entry.id !== draft.id), clean])) setDraft(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Template tidak valid."); }
  }
  return <main className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><Button asChild variant="ghost" size="sm" className="mb-3"><Link to="/jadwal"><ArrowLeft />Jadwal</Link></Button><h1 className="font-display text-3xl font-semibold">Pustaka jadwal</h1></div><Button onClick={() => { setError(""); setDraft({ id: crypto.randomUUID(), works: [blankWork()] }); }}><Plus />Tambah judul pekerjaan</Button></header>
    {!templates.length && <div className="flex min-h-48 flex-col items-center justify-center gap-3 border-y border-border"><BookOpen className="size-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">Belum ada judul pekerjaan.</p></div>}
    {templates.map((template) => <section key={template.id} className="mb-6 border-b border-border pb-5"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-display text-lg font-semibold">{template.works[0]?.title}</h2><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${template.works[0]?.title}`} title="Edit template" onClick={() => { setError(""); setDraft(structuredClone(template)); }}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" aria-label={`Hapus ${template.works[0]?.title}`} title="Hapus template" onClick={() => setDeleting(template.id)}><Trash2 className="size-4" /></Button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="bg-surface text-xs text-muted-foreground"><tr>{["WBS", "Judul pekerjaan", "Durasi", "Predecessor"].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{template.works.map((work) => <tr key={work.id} className="border-b border-border/60"><td className="px-3 py-2 text-primary">{work.wbs}</td><td className="px-3 py-2">{work.title}</td><td className="px-3 py-2 tabular-nums">{work.duration} hari</td><td className="px-3 py-2">{work.predecessor.toUpperCase() || "—"}</td></tr>)}</tbody></table></div></section>)}
    <Dialog open={!!draft} onOpenChange={(open) => { if (!open && !saving) setDraft(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{templates.some((entry) => entry.id === draft?.id) ? "Edit template pekerjaan" : "Tambah template pekerjaan"}</DialogTitle></DialogHeader>{draft && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr>{["WBS", "Judul pekerjaan", "Durasi (hari)", "Predecessor", ""].map((label, index) => <th key={index} className="p-2">{label}</th>)}</tr></thead><tbody>{draft.works.map((work, index) => <tr key={work.id}><td className="w-28 p-1"><Input aria-label={`WBS pustaka ${index + 1}`} value={work.wbs} onChange={(event) => update(work.id, { wbs: event.target.value })} placeholder="a.a" /></td><td className="min-w-52 p-1"><Input aria-label={`Judul pustaka ${index + 1}`} value={work.title} onChange={(event) => update(work.id, { title: event.target.value })} /></td><td className="w-28 p-1"><Input aria-label={`Durasi pustaka ${index + 1}`} type="number" min={0} max={36500} value={work.duration} onChange={(event) => update(work.id, { duration: Number(event.target.value) })} /></td><td className="w-40 p-1"><Input aria-label={`Predecessor pustaka ${index + 1}`} value={work.predecessor} onChange={(event) => update(work.id, { predecessor: event.target.value })} placeholder="a.aFS+2" /></td><td><Button type="button" variant="ghost" size="icon" disabled={draft.works.length === 1} aria-label={`Hapus baris ${index + 1}`} title="Hapus baris" onClick={() => setDraft({ ...draft, works: draft.works.filter((row) => row.id !== work.id) })}><Trash2 className="size-4" /></Button></td></tr>)}</tbody></table></div><Button type="button" variant="outline" onClick={() => setDraft({ ...draft, works: [...draft.works, blankWork("")] })}><Plus />Judul pekerjaan</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>Batal</Button><Button type="submit" disabled={saving}>{saving ? "Menyimpan…" : "Simpan template"}</Button></DialogFooter></form>}</DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>Hapus template pekerjaan?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Seluruh hierarki template akan dihapus dari pustaka. Pekerjaan yang sudah diterapkan di jadwal tidak berubah.</p><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setDeleting(null)}>Batal</Button><Button variant="destructive" disabled={saving} onClick={async () => { if (await persist(templates.filter((entry) => entry.id !== deleting))) setDeleting(null); }}>Hapus template</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}