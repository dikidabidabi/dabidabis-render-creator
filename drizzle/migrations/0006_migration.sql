-- Profiles: members only (no anonymous reads)
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles viewable by signed-in members"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Posts: members-only community feed
DROP POLICY IF EXISTS "Posts viewable by authenticated" ON public.posts;
CREATE POLICY "Posts viewable by signed-in members"
  ON public.posts FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Post likes/comments: only for posts the caller can see
DROP POLICY IF EXISTS "Post likes viewable by authenticated" ON public.post_likes;
CREATE POLICY "Post likes viewable with visible post"
  ON public.post_likes FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_likes.post_id));

DROP POLICY IF EXISTS "Post comments viewable by authenticated" ON public.post_comments;
CREATE POLICY "Post comments viewable with visible post"
  ON public.post_comments FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_comments.post_id));

-- Render likes/comments: only for renders the caller can see (own or completed)
DROP POLICY IF EXISTS "Likes viewable by everyone" ON public.render_likes;
CREATE POLICY "Render likes viewable with visible render"
  ON public.render_likes FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.renders r WHERE r.id = render_likes.render_id));

DROP POLICY IF EXISTS "Comments viewable by everyone" ON public.render_comments;
CREATE POLICY "Render comments viewable with visible render"
  ON public.render_comments FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.renders r WHERE r.id = render_comments.render_id));

-- Comment reactions: only for comments the caller can see
DROP POLICY IF EXISTS "Reactions viewable by authenticated" ON public.render_comment_reactions;
CREATE POLICY "Reactions viewable with visible comment"
  ON public.render_comment_reactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.render_comments c WHERE c.id = render_comment_reactions.comment_id));

-- Storage: avatars readable by owner, or when used as someone's profile photo
DROP POLICY IF EXISTS "Authenticated read avatars" ON storage.objects;
CREATE POLICY "Read own or profile avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars' AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.avatar_url = storage.objects.name)
    )
  );

-- Storage: post files readable by owner, or when attached to a visible post
DROP POLICY IF EXISTS "Authenticated read posts bucket" ON storage.objects;
CREATE POLICY "Read own or attached post files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'posts' AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.posts p
        WHERE storage.objects.name IN (p.image_url, p.tor_url, p.sketch_url)
      )
    )
  );

-- Storage: render images readable by owner, or when the render is completed
DROP POLICY IF EXISTS "Authenticated read renders bucket" ON storage.objects;
CREATE POLICY "Read own or completed render images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'renders' AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.renders r
        WHERE r.status = 'completed'
          AND storage.objects.name LIKE (r.user_id::text || '/' || r.id::text || '.%')
      )
    )
  );