import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchFormulaSettings, loadFormulaSettings } from "@/lib/formula-settings";

export type SignUpMeta = {
  account_type: "perorangan" | "korporasi";
  professional_level?: string | null;
  corporate_code?: string | null;
  corporate_parent_code?: string | null;
  display_name?: string | null;
};

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    meta?: SignUpMeta,
  ) => Promise<{ error: string | null; hasSession: boolean }>;
  signOut: () => Promise<void>;
};

function authErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(message)) {
    return "Layanan akun sedang tidak dapat dijangkau. Periksa koneksi Anda, lalu coba lagi beberapa saat.";
  }
  return message || "Terjadi kendala pada layanan akun. Silakan coba lagi.";
}


const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      loadFormulaSettings(s?.user?.id ?? null);
      if (s?.user?.id) void fetchFormulaSettings(s.user.id);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      loadFormulaSettings(data.session?.user?.id ?? null);
      if (data.session?.user?.id) void fetchFormulaSettings(data.session.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? authErrorMessage(error) : null };
    } catch (error) {
      return { error: authErrorMessage(error) };
    }
  };

  const signUp = async (email: string, password: string, meta?: SignUpMeta) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/feed`,
          ...(meta ? { data: meta as Record<string, unknown> } : {}),
        },
      });
      return { error: error ? authErrorMessage(error) : null, hasSession: Boolean(data.session) };
    } catch (error) {
      return { error: authErrorMessage(error), hasSession: false };
    }
  };


  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
