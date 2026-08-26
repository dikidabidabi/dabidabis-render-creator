CREATE TABLE public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text,
  shared_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  shared_render_id uuid REFERENCES public.renders(id) ON DELETE SET NULL,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.direct_messages TO authenticated;
GRANT ALL ON public.direct_messages TO service_role;

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view messages"
ON public.direct_messages FOR SELECT TO authenticated
USING (auth.uid() = from_user OR auth.uid() = to_user);

CREATE POLICY "Users send messages as self"
ON public.direct_messages FOR INSERT TO authenticated
WITH CHECK (auth.uid() = from_user);

CREATE POLICY "Recipient can mark message read"
ON public.direct_messages FOR UPDATE TO authenticated
USING (auth.uid() = to_user) WITH CHECK (auth.uid() = to_user);

CREATE POLICY "Sender can delete own message"
ON public.direct_messages FOR DELETE TO authenticated
USING (auth.uid() = from_user);

CREATE INDEX direct_messages_pair_idx ON public.direct_messages (from_user, to_user, created_at DESC);
CREATE INDEX direct_messages_inbox_idx ON public.direct_messages (to_user, read_at);

CREATE TABLE public.feed_seen (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_seen TO authenticated;
GRANT ALL ON public.feed_seen TO service_role;

ALTER TABLE public.feed_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own feed seen"
ON public.feed_seen FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_feed_seen_updated_at
BEFORE UPDATE ON public.feed_seen
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();