CREATE TABLE public.formula_settings (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.formula_settings TO authenticated;
GRANT ALL ON public.formula_settings TO service_role;
ALTER TABLE public.formula_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own formula settings" ON public.formula_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);