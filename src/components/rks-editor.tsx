import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import TextAlign from "@tiptap/extension-text-align";
import {
  BetweenHorizontalEnd, BetweenVerticalEnd, Bold, Grid2x2X, Italic, ListIndentDecrease, ListIndentIncrease,
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ListOrdered, ListTree, Pilcrow, Redo2, Rows3, Columns3, Table2, Underline, Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { isRksAlign, type RksAlign, type RksDoc } from "@/lib/rks-content";

type Props = {
  initial: RksDoc | null;
  ariaLabel: string;
  placeholder: string;
  onChange: (doc: JSONContent) => void;
};

/** Penyunting narasi RKS: penomoran 3 level, sub-poin a/b/c, geser indentasi, dan tabel. */
export default function RksEditor({ initial, ariaLabel, placeholder, onChange }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, blockquote: false, horizontalRule: false, strike: false, link: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder }),
      TextAlign.configure({ types: ["paragraph"], alignments: ["left", "center", "right", "justify"] }),
    ],
    content: initial ?? { type: "doc", content: [{ type: "paragraph" }] },
    autofocus: "end",
    editorProps: { attributes: { class: "rks-editor-content", "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor: current }) => onChange(current.getJSON()),
  });
  return (
    <div className="flex min-h-0 flex-col">
      {editor && <Toolbar editor={editor} />}
      <div className="rks-editor h-[min(60vh,520px)] min-h-40 resize-y overflow-auto px-4 py-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function olDepth(editor: Editor): number {
  const { $from } = editor.state.selection;
  let depth = 0;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "orderedList") depth++;
  return depth;
}

/** Perataan paragraf aktif; tanpa pilihan, narasi rata kiri-kanan dan isi tabel rata kiri. */
function currentAlign(editor: Editor): RksAlign {
  const { $from } = editor.state.selection;
  let inCell = false;
  let align: unknown = null;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "paragraph" && align === null) align = node.attrs.textAlign;
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") inCell = true;
  }
  return isRksAlign(align) ? align : inCell ? "left" : "justify";
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      ordered: e.isActive("orderedList"),
      bullet: e.isActive("bulletList"),
      inList: e.isActive("listItem"),
      table: e.isActive("table"),
      canSink: e.can().sinkListItem("listItem"),
      canLift: e.can().liftListItem("listItem"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      level: olDepth(e),
      align: currentAlign(e),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-2 py-1" onMouseDown={(event) => { if ((event.target as HTMLElement).closest("button")) event.preventDefault(); }}>
      <Tool label="Urungkan (Ctrl+Z)" disabled={!state.canUndo} onClick={() => chain().undo().run()}><Undo2 /></Tool>
      <Tool label="Ulangi (Ctrl+Y)" disabled={!state.canRedo} onClick={() => chain().redo().run()}><Redo2 /></Tool>
      <Sep />
      <Tool label="Tebal (Ctrl+B)" active={state.bold} onClick={() => chain().toggleBold().run()}><Bold /></Tool>
      <Tool label="Miring (Ctrl+I)" active={state.italic} onClick={() => chain().toggleItalic().run()}><Italic /></Tool>
      <Tool label="Garis bawah (Ctrl+U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}><Underline /></Tool>
      <Sep />
      <Tool label="Rata kiri (Ctrl+Shift+L)" active={state.align === "left"} onClick={() => chain().setTextAlign("left").run()}><AlignLeft /></Tool>
      <Tool label="Rata tengah (Ctrl+Shift+E)" active={state.align === "center"} onClick={() => chain().setTextAlign("center").run()}><AlignCenter /></Tool>
      <Tool label="Rata kanan (Ctrl+Shift+R)" active={state.align === "right"} onClick={() => chain().setTextAlign("right").run()}><AlignRight /></Tool>
      <Tool label="Rata kiri-kanan / justify (Ctrl+Shift+J)" active={state.align === "justify"} onClick={() => chain().setTextAlign("justify").run()}><AlignJustify /></Tool>
      <Sep />
      <Tool label="Paragraf biasa" active={!state.inList && !state.table} onClick={() => {
        let c = chain();
        for (let i = 0; i < 6; i++) c = c.liftListItem("listItem");
        c.run();
      }}><Pilcrow /></Tool>
      <Tool label="Penomoran pasal (P.4., P.4.1., P.4.1.1.)" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}><ListOrdered /></Tool>
      <Tool label="Sub-poin a., b., c." active={state.bullet && !state.ordered} onClick={() => chain().toggleBulletList().run()}><ListTree /></Tool>
      <Tool label="Geser ke kiri / naik level (Shift+Tab)" disabled={!state.canLift} onClick={() => chain().liftListItem("listItem").run()}><ListIndentDecrease /></Tool>
      <Tool label="Geser ke kanan / sub-level (Tab)" disabled={!state.canSink} onClick={() => chain().sinkListItem("listItem").run()}><ListIndentIncrease /></Tool>
      {state.level > 0 && <span className="px-1.5 text-[11px] text-muted-foreground">Level {Math.min(state.level, 3)}{state.level > 3 ? " (a, b)" : ""}</span>}
      <Sep />
      <Tool label="Sisipkan tabel 3 × 3" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></Tool>
      {state.table && (
        <>
          <Tool label="Tambah baris di bawah" onClick={() => chain().addRowAfter().run()}><BetweenHorizontalEnd /></Tool>
          <Tool label="Tambah kolom di kanan" onClick={() => chain().addColumnAfter().run()}><BetweenVerticalEnd /></Tool>
          <Tool label="Hapus baris" onClick={() => chain().deleteRow().run()}><Rows3 /></Tool>
          <Tool label="Hapus kolom" onClick={() => chain().deleteColumn().run()}><Columns3 /></Tool>
          <Tool label="Hapus tabel" onClick={() => chain().deleteTable().run()}><Grid2x2X /></Tool>
        </>
      )}
    </div>
  );
}

function Tool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant={active ? "secondary" : "ghost"} size="icon" className="h-7 w-7 [&_svg]:size-3.5" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

function Sep() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border" />;
}
