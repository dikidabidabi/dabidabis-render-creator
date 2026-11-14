CREATE OR REPLACE FUNCTION public.can_access_share(_share_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
    AND _user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.shared_presentations s
      WHERE s.id = _share_id
        AND (s.from_user = _user_id OR s.to_user = _user_id)
    )
$function$;

REVOKE EXECUTE ON FUNCTION public.can_access_share(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_share(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.share_participants(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_participants(uuid) TO authenticated, service_role;