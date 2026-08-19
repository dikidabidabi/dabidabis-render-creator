ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS professional_level text,
  ADD COLUMN IF NOT EXISTS corporate_code text,
  ADD COLUMN IF NOT EXISTS corporate_parent_code text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_corporate_code_key
  ON public.profiles (lower(corporate_code)) WHERE corporate_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_corporate_parent_idx
  ON public.profiles (lower(corporate_parent_code));

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'post',
  body text,
  image_url text,
  tender_deadline date,
  tor_url text,
  data_link text,
  project_address text,
  repost_of_post uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  repost_of_render uuid REFERENCES public.renders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Posts viewable by authenticated" ON public.posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own post" ON public.posts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own post" ON public.posts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own post" ON public.posts FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX posts_created_idx ON public.posts (created_at DESC);
CREATE INDEX posts_user_idx ON public.posts (user_id, created_at DESC);

CREATE TABLE public.post_likes (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.post_likes TO authenticated;
GRANT ALL ON public.post_likes TO service_role;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Post likes viewable by authenticated" ON public.post_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users like post as self" ON public.post_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users remove own post like" ON public.post_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.post_comments TO authenticated;
GRANT ALL ON public.post_comments TO service_role;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Post comments viewable by authenticated" ON public.post_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users comment post as self" ON public.post_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own post comment" ON public.post_comments FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX post_comments_post_idx ON public.post_comments (post_id, created_at);

CREATE POLICY "Authenticated read posts bucket" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'posts');
CREATE POLICY "Users upload own post file" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'posts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users update own post file" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'posts' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own post file" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'posts' AND (storage.foldername(name))[1] = auth.uid()::text);