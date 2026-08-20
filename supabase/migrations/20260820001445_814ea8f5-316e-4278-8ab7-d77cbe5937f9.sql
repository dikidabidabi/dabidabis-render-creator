ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS tender_title text,
  ADD COLUMN IF NOT EXISTS project_lat double precision,
  ADD COLUMN IF NOT EXISTS project_lon double precision;