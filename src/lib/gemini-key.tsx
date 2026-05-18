import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { KeyRound } from "lucide-react";

const STORAGE_KEY = "gemini_api_key";

export function getGeminiApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) ?? "";
}

export function GeminiKeyInput() {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(getGeminiApiKey());
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    if (v) window.localStorage.setItem(STORAGE_KEY, v);
    else window.localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="relative hidden md:block">
      <KeyRound className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="password"
        value={value}
        onChange={onChange}
        placeholder="Masukkan Gemini API Key"
        className="h-8 w-56 pl-7 text-xs"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
