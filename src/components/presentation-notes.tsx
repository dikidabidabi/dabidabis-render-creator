// Overlay komentar (coretan + teks) untuk slide presentasi.
// Dipakai penerima kiriman untuk mencoret/menulis, dan pemilik presentasi
// sumber untuk menampilkan layer komentar tersebut.
import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Pencil, Type, MousePointer2, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  NOTE_H,
  NOTE_W,
  fetchShareNotes,
  noteTransform,
  saveNote,
  strokePath,
  type NoteLayer,
  type NoteRow,
  type NoteStroke,
  type NoteText,
  type NoteView,
} from "@/lib/presentation-notes";

const COLORS = ["#e2571e", "#1d4ed8", "#16a34a", "#111827"];

type SlideNote = { strokes: NoteStroke[]; texts: NoteText[] };

const EMPTY: SlideNote = { strokes: [], texts: [] };

function svgPoint(el: SVGSVGElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * NOTE_W,
    y: ((clientY - rect.top) / rect.height) * NOTE_H,
  };
}

/** Render satu atau beberapa layer komentar (read-only). */
export function NoteLayerView({
  layers,
  currentView,
  anchor,
}: {
  layers: Array<Pick<NoteLayer, "id" | "strokes" | "texts" | "view">>;
  /** Zoom/pan gambar slide saat ini (sisi pemilik presentasi). */
  currentView?: NoteView | null;
  /** Pusat kotak gambar dalam ruang A3. */
  anchor?: { cx: number; cy: number } | null;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={NOTE_W}
      height={NOTE_H}
      viewBox={`0 0 ${NOTE_W} ${NOTE_H}`}
    >
      {layers.map((l) => (
        <g key={l.id} transform={noteTransform(l.view ?? null, currentView ?? null, anchor ?? null)}>
          {l.strokes.map((s) => (
            <path
              key={s.id}
              d={strokePath(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {l.texts.map((t) => (
            <text
              key={t.id}
              x={t.x}
              y={t.y}
              fill={t.color}
              fontSize={t.size}
              fontWeight={600}
              style={{ fontFamily: "Manrope, system-ui, sans-serif" }}
            >
              {t.text}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

/**
 * Editor komentar per halaman. Mengembalikan overlay (ditempel di atas slide)
 * dan toolbar (ditempel di bawah slide).
 */
export function useSlideNoteEditor(args: {
  shareId: string;
  slideId: string | undefined;
  slideTitle: string;
  author: string | undefined;
  /** Zoom/pan gambar slide dari presentasi sumber, disimpan bersama komentar. */
  view?: NoteView | null;
}) {
  const { shareId, slideId, slideTitle, author, view } = args;
  const [tool, setTool] = useState<"none" | "draw" | "text" | "erase">("none");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);
  const [fontSize, setFontSize] = useState(28);
  const [notes, setNotes] = useState<Record<string, SlideNote>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const drawing = useRef<NoteStroke | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let alive = true;
    if (!shareId) { setLoading(false); return; }
    setLoading(true);
    fetchShareNotes(shareId)
      .then((rows: NoteRow[]) => {
        if (!alive) return;
        const map: Record<string, SlideNote> = {};
        for (const r of rows) {
          if (author && r.author !== author) continue;
          map[r.slide_id] = { strokes: r.strokes, texts: r.texts };
        }
        setNotes(map);
      })
      .catch(() => void 0)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [shareId, author]);

  const current = (slideId && notes[slideId]) || EMPTY;

  const patch = useCallback(
    (next: SlideNote) => {
      if (!slideId) return;
      setNotes((prev) => ({ ...prev, [slideId]: next }));
      setDirty(true);
    },
    [slideId],
  );

  const persist = useCallback(async () => {
    if (!slideId || !author) return;
    setSaving(true);
    try {
      await saveNote({
        shareId,
        slideId,
        slideTitle,
        author,
        strokes: current.strokes,
        texts: current.texts,
        view: view ?? null,
      });
      setDirty(false);
      toast.success("Komentar halaman tersimpan dan terkirim ke pemilik presentasi.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan komentar.");
    } finally {
      setSaving(false);
    }
  }, [shareId, slideId, slideTitle, author, current, view]);

  // Coretan aktif digambar lewat ref + rAF agar tidak memicu re-render per titik.
  const liveRef = useRef<SVGPathElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef(false);

  const flushLive = useCallback(() => {
    rafRef.current = null;
    pendingRef.current = false;
    const s = drawing.current;
    if (s && liveRef.current) liveRef.current.setAttribute("d", strokePath(s));
  }, []);

  const scheduleLive = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    rafRef.current = requestAnimationFrame(flushLive);
  }, [flushLive]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "none" || !svgRef.current || !slideId) return;
    const p = svgPoint(svgRef.current, e.clientX, e.clientY);
    if (tool === "draw") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = {
        id: `s${Date.now()}`,
        points: [Math.round(p.x), Math.round(p.y)],
        color,
        width,
      };
      if (liveRef.current) {
        liveRef.current.setAttribute("stroke", color);
        liveRef.current.setAttribute("stroke-width", String(width));
        liveRef.current.setAttribute("d", "");
      }
      return;
    }
    if (tool === "text") {
      const text = window.prompt("Teks komentar:");
      if (!text?.trim()) return;
      patch({
        ...current,
        texts: [
          ...current.texts,
          { id: `t${Date.now()}`, x: Math.round(p.x), y: Math.round(p.y), text: text.trim(), color, size: fontSize },
        ],
      });
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing.current || !svgRef.current) return;
    e.preventDefault();
    const events =
      typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : [];
    const pts = events.length > 0 ? events : [e.nativeEvent];
    for (const ev of pts) {
      const p = svgPoint(svgRef.current, ev.clientX, ev.clientY);
      const arr = drawing.current.points;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      // Lewati titik yang terlalu dekat agar path tetap ringan.
      if (arr.length >= 2 && Math.abs(arr[arr.length - 2] - x) < 2 && Math.abs(arr[arr.length - 1] - y) < 2) continue;
      arr.push(x, y);
    }
    scheduleLive();
  };

  const onPointerUp = () => {
    const s = drawing.current;
    drawing.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingRef.current = false;
    if (liveRef.current) liveRef.current.setAttribute("d", "");
    if (s && s.points.length >= 4) patch({ ...current, strokes: [...current.strokes, s] });
  };

  const eraseStroke = (id: string) => {
    if (tool !== "erase") return;
    patch({ ...current, strokes: current.strokes.filter((s) => s.id !== id) });
  };
  const eraseText = (id: string) => {
    if (tool !== "erase") return;
    patch({ ...current, texts: current.texts.filter((t) => t.id !== id) });
  };

  const overlay = (
    <svg
      ref={svgRef}
      width={NOTE_W}
      height={NOTE_H}
      viewBox={`0 0 ${NOTE_W} ${NOTE_H}`}
      className={cn(
        "absolute inset-0 touch-none select-none",
        tool === "none" ? "pointer-events-none" : "cursor-crosshair",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {current.strokes.map((s) => (
        <path
          key={s.id}
          d={strokePath(s)}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          onClick={() => eraseStroke(s.id)}
          style={{ pointerEvents: tool === "erase" ? "stroke" : "none", cursor: tool === "erase" ? "pointer" : undefined }}
        />
      ))}
      <path
        ref={liveRef}
        d=""
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: "none" }}
      />
      {current.texts.map((t) => (
        <text
          key={t.id}
          x={t.x}
          y={t.y}
          fill={t.color}
          fontSize={t.size}
          fontWeight={600}
          style={{
            fontFamily: "Manrope, system-ui, sans-serif",
            pointerEvents: tool === "erase" ? "auto" : "none",
            cursor: tool === "erase" ? "pointer" : undefined,
          }}
          onClick={() => eraseText(t.id)}
        >
          {t.text}
        </text>
      ))}
    </svg>
  );


  const toolbar = (
    <div className="no-print flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">Komentar halaman:</span>
      {(
        [
          ["none", MousePointer2, "Nonaktif"],
          ["draw", Pencil, "Coret"],
          ["text", Type, "Teks"],
          ["erase", Eraser, "Hapus"],
        ] as const
      ).map(([id, Icon, label]) => (
        <Button
          key={id}
          variant={tool === id ? "default" : "secondary"}
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px]"
          onClick={() => setTool(id)}
          title={label}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </Button>
      ))}
      <div className="flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            title="Warna"
            className={cn(
              "h-5 w-5 rounded-full border-2",
              color === c ? "border-foreground" : "border-transparent",
            )}
            style={{ background: c }}
          />
        ))}
      </div>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Tebal
        <input
          type="range"
          min={2}
          max={16}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="h-1 w-16"
        />
      </label>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Teks
        <input
          type="range"
          min={14}
          max={72}
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          className="h-1 w-16"
        />
      </label>
      <Button
        size="sm"
        className="h-7 gap-1.5 px-2 text-[11px]"
        onClick={() => void persist()}
        disabled={saving || loading || !dirty || !author}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Simpan
      </Button>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
    </div>
  );

  return { overlay, toolbar };
}
