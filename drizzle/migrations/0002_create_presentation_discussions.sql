CREATE TABLE public.presentation_discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.shared_presentations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX presentation_discussions_share_idx ON public.presentation_discussions (share_id, created_at);

GRANT SELECT, INSERT, DELETE ON public.presentation_discussions TO authenticated;
GRANT ALL ON public.presentation_discussions TO service_role;

ALTER TABLE public.presentation_discussions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Share participants can view discussion"
  ON public.presentation_discussions FOR SELECT TO authenticated
  USING (public.can_access_share(share_id, auth.uid()));

CREATE POLICY "Share participants can post discussion"
  ON public.presentation_discussions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_access_share(share_id, auth.uid()));

CREATE POLICY "Authors delete own discussion"
  ON public.presentation_discussions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);