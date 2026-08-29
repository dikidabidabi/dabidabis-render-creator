CREATE TABLE public.presentation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.shared_presentations(id) ON DELETE CASCADE,
  slide_id text NOT NULL,
  slide_title text,
  author uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strokes jsonb NOT NULL DEFAULT '[]'::jsonb,
  texts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (share_id, slide_id, author)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.presentation_notes TO authenticated;
GRANT ALL ON public.presentation_notes TO service_role;

ALTER TABLE public.presentation_notes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_share(_share_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_presentations s
    WHERE s.id = _share_id
      AND (s.from_user = _user_id OR s.to_user = _user_id)
  )
$$;

CREATE POLICY "Share participants can view notes"
ON public.presentation_notes FOR SELECT TO authenticated
USING (public.can_access_share(share_id, auth.uid()));

CREATE POLICY "Participants insert own notes"
ON public.presentation_notes FOR INSERT TO authenticated
WITH CHECK (auth.uid() = author AND public.can_access_share(share_id, auth.uid()));

CREATE POLICY "Authors update own notes"
ON public.presentation_notes FOR UPDATE TO authenticated
USING (auth.uid() = author) WITH CHECK (auth.uid() = author);

CREATE POLICY "Authors delete own notes"
ON public.presentation_notes FOR DELETE TO authenticated
USING (auth.uid() = author);

CREATE TRIGGER update_presentation_notes_updated_at
BEFORE UPDATE ON public.presentation_notes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Batas: satu judul presentasi maksimal dibagikan ke 5 akun lain.
CREATE OR REPLACE FUNCTION public.enforce_share_recipient_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt integer;
BEGIN
  SELECT count(DISTINCT to_user) INTO cnt
  FROM public.shared_presentations
  WHERE from_user = NEW.from_user
    AND title = NEW.title
    AND to_user <> NEW.to_user;
  IF cnt >= 5 THEN
    RAISE EXCEPTION 'Presentasi ini sudah dibagikan ke 5 akun (batas maksimal).';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_share_recipient_limit_trg
BEFORE INSERT ON public.shared_presentations
FOR EACH ROW EXECUTE FUNCTION public.enforce_share_recipient_limit();