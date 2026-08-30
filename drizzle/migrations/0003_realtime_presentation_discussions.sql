ALTER TABLE public.presentation_discussions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.presentation_discussions;