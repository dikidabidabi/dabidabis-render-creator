CREATE OR REPLACE FUNCTION public.share_participants(_share_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.uid FROM (
    SELECT s.from_user AS uid
      FROM public.shared_presentations s
     WHERE s.id = _share_id
    UNION
    SELECT s2.to_user
      FROM public.shared_presentations s2
      JOIN public.shared_presentations s ON s.id = _share_id
     WHERE s2.from_user = s.from_user AND s2.title = s.title
  ) p
  WHERE public.can_access_share(_share_id, auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.share_participants(uuid) TO authenticated;