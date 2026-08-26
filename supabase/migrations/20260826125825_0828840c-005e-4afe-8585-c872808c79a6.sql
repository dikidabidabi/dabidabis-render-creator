ALTER TABLE public.render_comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.render_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS render_comments_parent_idx ON public.render_comments(parent_id);

DROP POLICY IF EXISTS "Users update own comment" ON public.render_comments;
CREATE POLICY "Users update own comment" ON public.render_comments
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.render_comment_reactions (
  comment_id uuid NOT NULL REFERENCES public.render_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id, emoji)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_comment_reactions TO authenticated;
GRANT ALL ON public.render_comment_reactions TO service_role;
ALTER TABLE public.render_comment_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reactions viewable by authenticated" ON public.render_comment_reactions;
CREATE POLICY "Reactions viewable by authenticated" ON public.render_comment_reactions
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users react as self" ON public.render_comment_reactions;
CREATE POLICY "Users react as self" ON public.render_comment_reactions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users remove own reaction" ON public.render_comment_reactions;
CREATE POLICY "Users remove own reaction" ON public.render_comment_reactions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.render_comment_seen (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  render_id uuid NOT NULL REFERENCES public.renders(id) ON DELETE CASCADE,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, render_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_comment_seen TO authenticated;
GRANT ALL ON public.render_comment_seen TO service_role;
ALTER TABLE public.render_comment_seen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own comment seen" ON public.render_comment_seen;
CREATE POLICY "Users manage own comment seen" ON public.render_comment_seen
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_render_comment_seen_updated_at BEFORE UPDATE ON public.render_comment_seen
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();