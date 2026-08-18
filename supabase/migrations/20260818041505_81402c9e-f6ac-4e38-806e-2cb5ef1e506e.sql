CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  bio text,
  qualifications text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.render_likes (
  render_id uuid NOT NULL REFERENCES public.renders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (render_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.render_likes TO authenticated;
GRANT SELECT ON public.render_likes TO anon;
GRANT ALL ON public.render_likes TO service_role;
ALTER TABLE public.render_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Likes viewable by everyone" ON public.render_likes FOR SELECT USING (true);
CREATE POLICY "Users like as self" ON public.render_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users remove own like" ON public.render_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.render_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_id uuid NOT NULL REFERENCES public.renders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.render_comments TO authenticated;
GRANT SELECT ON public.render_comments TO anon;
GRANT ALL ON public.render_comments TO service_role;
ALTER TABLE public.render_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Comments viewable by everyone" ON public.render_comments FOR SELECT USING (true);
CREATE POLICY "Users comment as self" ON public.render_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own comment" ON public.render_comments FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX render_comments_render_idx ON public.render_comments(render_id, created_at);

CREATE POLICY "Authenticated can view completed renders" ON public.renders FOR SELECT TO authenticated USING (status = 'completed');

CREATE POLICY "Authenticated read renders bucket" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'renders');

CREATE POLICY "Authenticated read avatars" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars');
CREATE POLICY "Users upload own avatar" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users update own avatar" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own avatar" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);