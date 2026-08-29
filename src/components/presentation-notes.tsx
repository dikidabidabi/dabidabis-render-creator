// Overlay komentar (coretan + teks) untuk slide presentasi.
// Dipakai penerima kiriman untuk mencoret/menulis, dan pemilik presentasi
// sumber untuk menampilkan layer komentar tersebut.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Pencil, Type, MousePointer2, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  NOTE_H,
  NOTE_W,
  fetchShareNotes,
  saveNote,
  strokePath,
  type NoteLayer,
  type NoteRow,
  type NoteStroke,
  type NoteText,
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
export function NoteLayerView({ layers }: { layers: Array<Pick<NoteLayer, "id" | "strokes" | "texts">> }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={NOTE_W}
      height={NOTE_H}
      viewBox={`0 0 ${NOTE_W} ${NOTE_H}`}
    >
      {layers.map((l) => (
        <g key={l.id}>
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
}) {
  const { shareId, slideId, slideTitle, author } = args;
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
      });
      setDirty(false);
      toast.success("Komentar halaman tersimpan dan terkirim ke pemilik presentasi.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan komentar.");
    } finally {
      setSaving(false);
    }
  }, [shareId, slideId, slideTitle, author, current]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "none" || !svgRef.current || !slideId) return;
    const p = svgPoint(svgRef.current, e.clientX, e.clientY);
    if (tool === "draw") {
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = {
        id: `s${Date.now()}`,
        points: [Math.round(p.x), Math.round(p.y)],
        color,
        width,
      };
      patch({ ...current, strokes: [...current.strokes, drawing.current] });
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
    const p = svgPoint(svgRef.current, e.clientX, e.clientY);
    drawing.current.points.push(Math.round(p.x), Math.round(p.y));
    const stroke = { ...drawing.current, points: [...drawing.current.points] };
    patch({
      ...current,
      strokes: [...current.strokes.slice(0, -1), stroke],
    });
  };

  const onPointerUp = () => {
    drawing.current = null;
  };

  const eraseStroke = (id: string) => {
    if (tool !== "erase") return;
    patch({ ...current, strokes: current.strokes.filter((s) => s.id !== id) });
  };
  const eraseText = (id: string) => {
    if (tool !== "erase") return;
    patch({ ...current, texts: current.texts.filter((t) => t.id !== id) });
  };

  const overlay = useMemo(
    () => (
      <svg
        ref={svgRef}
        width={NOTE_W}
        height={NOTE_H}
        viewBox={`0 0 ${NOTE_W} ${NOTE_H}`}
        className={cn(
          "absolute inset-0",
          tool === "none" ? "pointer-events-none" : "cursor-crosshair",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, tool, color, width, fontSize, slideId],
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
