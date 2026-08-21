CREATE TABLE public.shared_presentations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.shared_presentations TO authenticated;
GRANT ALL ON public.shared_presentations TO service_role;

ALTER TABLE public.shared_presentations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sender or recipient can view share"
ON public.shared_presentations FOR SELECT TO authenticated
USING (auth.uid() = from_user OR auth.uid() = to_user);

CREATE POLICY "Users share as themselves"
ON public.shared_presentations FOR INSERT TO authenticated
WITH CHECK (auth.uid() = from_user);

CREATE POLICY "Sender or recipient can delete share"
ON public.shared_presentations FOR DELETE TO authenticated
USING (auth.uid() = from_user OR auth.uid() = to_user);

CREATE INDEX shared_presentations_to_user_idx ON public.shared_presentations (to_user, created_at DESC);