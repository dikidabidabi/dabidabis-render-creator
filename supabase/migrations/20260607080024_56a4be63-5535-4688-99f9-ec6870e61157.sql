
-- Storage policies for "backups" bucket: per-user folder
CREATE POLICY "Users can read own backups"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can upload own backups"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update own backups"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own backups"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'backups' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Metadata table
CREATE TABLE public.cloud_backups (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  byte_size BIGINT NOT NULL DEFAULT 0,
  sketch_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cloud_backups TO authenticated;
GRANT ALL ON public.cloud_backups TO service_role;

ALTER TABLE public.cloud_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own backup metadata"
  ON public.cloud_backups FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
