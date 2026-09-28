DROP FUNCTION app_private.list_moderation_cases(uuid,text,integer);

CREATE FUNCTION app_private.list_moderation_cases(p_session_id uuid, p_status text, p_limit integer)
RETURNS TABLE (
  id uuid, contribution_id uuid, case_status text, case_version bigint,
  title text, description text, kind text, contribution_status text, zone_name text,
  geometry text, author_alias text, confirmations bigint, rejections bigint,
  own_claim boolean, created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; actor_roles text[];
BEGIN
  SELECT candidate.user_id,candidate.roles INTO actor_id,actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT (coalesce(actor_roles,ARRAY[]::text[]) && ARRAY['moderator','administrator']::text[]) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='moderation_required';
  END IF;
  RETURN QUERY
  SELECT moderation.id,moderation.contribution_id,moderation.status,moderation.version,
    contribution.title,contribution.description,contribution.kind,contribution.status,zone.name,
    extensions.ST_AsGeoJSON(contribution.geometry,6),account.public_alias,
    count(reaction.*) FILTER (WHERE reaction.reaction='confirm'),
    count(reaction.*) FILTER (WHERE reaction.reaction='reject'),
    moderation.claimed_by=actor_id,moderation.created_at,moderation.updated_at
  FROM app_private.moderation_cases moderation
  JOIN app.contributions contribution ON contribution.id=moderation.contribution_id
  JOIN app.users account ON account.id=contribution.author_id
  LEFT JOIN app.zones zone ON zone.id=contribution.zone_id
  LEFT JOIN app.contribution_reactions reaction ON reaction.contribution_id=contribution.id
  WHERE p_status IS NULL OR moderation.status=p_status
  GROUP BY moderation.id,contribution.id,zone.name,account.public_alias,actor_id
  ORDER BY moderation.created_at,moderation.id
  LIMIT greatest(1,least(coalesce(p_limit,50),100));
END;
$function$;

REVOKE ALL ON FUNCTION app_private.list_moderation_cases(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.list_moderation_cases(uuid,text,integer) TO rutaviva_runtime;
