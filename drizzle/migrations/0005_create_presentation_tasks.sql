CREATE TABLE public.presentation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.shared_presentations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.presentation_discussions(id) ON DELETE SET NULL,
  body text NOT NULL,
  creator uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  owner_done_at timestamp with time zone,
  creator_done_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.presentation_tasks TO authenticated;
GRANT ALL ON public.presentation_tasks TO service_role;

ALTER TABLE public.presentation_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Share participants can view tasks"
ON public.presentation_tasks FOR SELECT TO authenticated
USING (public.can_access_share(share_id, auth.uid()));

CREATE POLICY "Share participants create tasks as self"
ON public.presentation_tasks FOR INSERT TO authenticated
WITH CHECK (auth.uid() = creator AND public.can_access_share(share_id, auth.uid()));

CREATE POLICY "Creator or owner can update task"
ON public.presentation_tasks FOR UPDATE TO authenticated
USING (auth.uid() = creator OR auth.uid() = owner)
WITH CHECK (auth.uid() = creator OR auth.uid() = owner);

CREATE POLICY "Creator can delete task"
ON public.presentation_tasks FOR DELETE TO authenticated
USING (auth.uid() = creator);

CREATE TRIGGER update_presentation_tasks_updated_at
BEFORE UPDATE ON public.presentation_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX presentation_tasks_share_idx ON public.presentation_tasks(share_id, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.presentation_tasks;