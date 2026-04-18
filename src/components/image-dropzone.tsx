import { useRef, useState } from "react";
import { Upload, X, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  hint: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  className?: string;
};

export function ImageDropzone({ label, hint, value, onChange, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 8 * 1024 * 1024) {
      alert("Maksimal 8MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => onChange(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            Hapus
          </button>
        )}
      </div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        className={cn(
          "group relative flex aspect-[4/3] cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border/60 bg-surface/40 transition-all hover:border-ember/60 hover:bg-surface/60",
          dragOver && "border-ember bg-ember/5",
        )}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-background/0 transition-colors group-hover:bg-background/40" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
              <span className="rounded-md bg-background/80 px-3 py-1.5 text-xs backdrop-blur">
                Klik untuk ganti
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ember/10 text-ember">
              <Upload className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">Klik atau drop gambar</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>
    </div>
  );
}
