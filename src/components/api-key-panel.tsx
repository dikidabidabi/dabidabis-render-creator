import { useEffect, useState } from "react";
import { KeyRound, Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/api-key";
import { toast } from "sonner";

export function ApiKeyPanel({ onChange }: { onChange?: (hasKey: boolean) => void }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const k = getApiKey();
    setSaved(k);
    setEditing(!k);
    onChange?.(!!k);
  }, [onChange]);

  const handleSave = () => {
    const v = value.trim();
    if (!v.startsWith("AIza") || v.length < 30) {
      toast.error("API Key Google tidak valid (harus diawali 'AIza').");
      return;
    }
    setApiKey(v);
    setSaved(v);
    setValue("");
    setEditing(false);
    onChange?.(true);
    toast.success("API Key tersimpan di browser ini.");
  };

  const handleClear = () => {
    clearApiKey();
    setSaved(null);
    setEditing(true);
    onChange?.(false);
    toast.info("API Key dihapus.");
  };

  const mask = (k: string) => `${k.slice(0, 6)}••••••••${k.slice(-4)}`;

  return (
    <div className="rounded-xl border border-border/60 bg-surface/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-ember" />
        <Label className="text-sm">Google API Key (Imagen 3)</Label>
      </div>

      {saved && !editing ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-emerald-500" />
            <code className="font-mono text-xs text-muted-foreground">{mask(saved)}</code>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClear}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            type="password"
            placeholder="AIza..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Disimpan hanya di browser Anda (localStorage).
            </p>
            <div className="flex gap-2">
              {saved && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Batal
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={!value.trim()}>
                Simpan
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
