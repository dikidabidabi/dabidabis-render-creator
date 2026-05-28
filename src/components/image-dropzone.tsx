import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  label: string;
  hint: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  className?: string;
  compress?: boolean;
};

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_DATA_URL_BYTES = 850 * 1024;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === "string" && result.startsWith("data:image/")) resolve(result);
      else reject(new Error("Format gambar tidak valid."));
    };
    reader.onerror = () => reject(new Error("Browser gagal membaca berkas gambar."));
    reader.readAsDataURL(file);
  });
}

async function readCompressedImage(file: File) {
  const original = await readFileAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Gambar tidak dapat diproses. Gunakan JPG atau PNG."));
    image.src = original;
  });

  let maxDim = 1200;
  let quality = 0.78;
  let output = original;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * ratio));
    const height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Browser tidak mendukung kompresi gambar.");
    ctx.drawImage(img, 0, 0, width, height);
    output = canvas.toDataURL("image/jpeg", quality);
    if (output.length <= MAX_DATA_URL_BYTES) return output;
    maxDim *= 0.82;
    quality = Math.max(0.52, quality - 0.06);
  }
  return output;
}

export function ImageDropzone({ label, hint, value, onChange, className, compress = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      const message = "Berkas harus berupa gambar.";
      setError(message);
      toast.error(message);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      const message = "Ukuran gambar melebihi 8MB.";
      setError(message);
      toast.error(message);
      return;
    }
    setLoading(true);
    try {
      const dataUrl = compress ? await readCompressedImage(file) : await readFileAsDataUrl(file);
      onChange(dataUrl);
      toast.success("Gambar berhasil diunggah.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal membaca gambar.";
      console.error("[image-dropzone] upload gagal", err);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
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
      <label
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
          loading && "pointer-events-none opacity-70",
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
            <p className="text-sm font-medium">{loading ? "Mengunggah…" : "Klik atau drop gambar"}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        )}
        {loading && value && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-sm font-medium backdrop-blur-sm">
            Mengunggah…
          </div>
        )}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={loading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) handleFile(f);
          }}
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
