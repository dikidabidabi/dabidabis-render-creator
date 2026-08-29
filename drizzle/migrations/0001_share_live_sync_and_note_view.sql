-- Pemilik presentasi boleh memperbarui payload kiriman (sinkronisasi otomatis)
GRANT UPDATE ON public.shared_presentations TO authenticated;

DROP POLICY IF EXISTS "Pengirim dapat memperbarui kiriman" ON public.shared_presentations;
CREATE POLICY "Pengirim dapat memperbarui kiriman"
ON public.shared_presentations FOR UPDATE TO authenticated
USING (auth.uid() = from_user)
WITH CHECK (auth.uid() = from_user);

CREATE INDEX IF NOT EXISTS shared_presentations_from_user_title_idx
ON public.shared_presentations (from_user, title);

-- Snapshot zoom/pan gambar saat komentar dibuat, agar coretan terikat ke gambar
ALTER TABLE public.presentation_notes
ADD COLUMN IF NOT EXISTS view jsonb;