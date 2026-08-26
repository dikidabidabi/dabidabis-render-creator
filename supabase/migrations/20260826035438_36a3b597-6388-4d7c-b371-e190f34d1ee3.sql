ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS sketch_url text,
  ADD COLUMN IF NOT EXISTS sketch_title text,
  ADD COLUMN IF NOT EXISTS sketch_source text;