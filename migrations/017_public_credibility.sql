CREATE OR REPLACE FUNCTION app_private.community_stats()
RETURNS TABLE (
  published_count integer,
  pending_count integer,
  rejected_count integer,
  avg_resolution_hours numeric,
  network_version text,
  pilot_empty boolean,
  privacy_suppressed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH pilot AS (
    SELECT contribution.*
    FROM app.contributions contribution
    WHERE contribution.city_id = '10000000-0000-4000-8000-000000000001'::uuid
  ), aggregate AS (
    SELECT
      count(*) FILTER (WHERE status='published')::integer AS published_count,
      count(*) FILTER (WHERE status IN ('submitted','under_review'))::integer AS pending_count,
      count(*) FILTER (WHERE status='rejected')::integer AS rejected_count,
      count(DISTINCT author_id)::integer AS participant_count,
      count(*) FILTER (WHERE status IN ('submitted','under_review','published'))::integer AS active_count
    FROM pilot
  )
  SELECT
    CASE WHEN aggregate.participant_count=0 OR aggregate.participant_count>=5 THEN aggregate.published_count END,
    CASE WHEN aggregate.participant_count=0 OR aggregate.participant_count>=5 THEN aggregate.pending_count END,
    CASE WHEN aggregate.participant_count=0 OR aggregate.participant_count>=5 THEN aggregate.rejected_count END,
    CASE WHEN aggregate.participant_count>=5 THEN (
      SELECT avg(extract(epoch FROM (moderation.resolved_at-moderation.created_at))/3600.0)::numeric
      FROM app_private.moderation_cases moderation
      JOIN pilot contribution ON contribution.id=moderation.contribution_id
      WHERE moderation.status='resolved' AND moderation.resolved_at IS NOT NULL
    ) END,
    (SELECT release.version FROM app.network_releases release
      WHERE release.zone_id='20000000-0000-4000-8000-000000000001'::uuid AND release.status='published'
      ORDER BY release.published_at DESC,release.id LIMIT 1),
    aggregate.active_count=0,
    aggregate.participant_count BETWEEN 1 AND 4
  FROM aggregate;
$function$;

CREATE OR REPLACE FUNCTION app_private.zone_leaderboard()
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  sort_order integer,
  is_approximate boolean,
  bbox double precision[],
  published_count integer,
  pending_count integer,
  last_activity timestamptz,
  privacy_suppressed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    zone.id,
    zone.slug,
    zone.name,
    zone.sort_order,
    zone.is_approximate,
    ARRAY[
      extensions.ST_XMin(extensions.box3d(zone.boundary)),
      extensions.ST_YMin(extensions.box3d(zone.boundary)),
      extensions.ST_XMax(extensions.box3d(zone.boundary)),
      extensions.ST_YMax(extensions.box3d(zone.boundary))
    ],
    CASE WHEN activity.participant_count=0 OR activity.participant_count>=5 THEN activity.published_count END,
    CASE WHEN activity.participant_count=0 OR activity.participant_count>=5 THEN activity.pending_count END,
    CASE WHEN activity.participant_count>=5 THEN activity.last_activity END,
    activity.participant_count BETWEEN 1 AND 4
  FROM app.zones zone
  JOIN app.cities city ON city.id=zone.city_id
  CROSS JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE contribution.status='published')::integer AS published_count,
      count(*) FILTER (WHERE contribution.status IN ('submitted','under_review'))::integer AS pending_count,
      count(DISTINCT contribution.author_id)::integer AS participant_count,
      max(contribution.updated_at) FILTER (WHERE contribution.status IN ('submitted','under_review','published')) AS last_activity
    FROM app.contributions contribution
    WHERE contribution.zone_id=zone.id
  ) activity
  WHERE city.id='10000000-0000-4000-8000-000000000001'::uuid
    AND city.is_active=true
    AND zone.is_active=true
  ORDER BY zone.sort_order,zone.id;
$function$;

CREATE OR REPLACE FUNCTION app_private.activity_summary()
RETURNS TABLE (
  window_days integer,
  published_count integer,
  submitted_count integer,
  resolved_count integer,
  privacy_suppressed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH windows(window_days) AS (VALUES (7),(30)), aggregate AS (
    SELECT
      window_days,
      count(*) FILTER (WHERE contribution.published_at>statement_timestamp()-make_interval(days=>window_days))::integer AS published_count,
      count(*) FILTER (WHERE contribution.created_at>statement_timestamp()-make_interval(days=>window_days))::integer AS submitted_count,
      count(DISTINCT contribution.author_id) FILTER (WHERE contribution.created_at>statement_timestamp()-make_interval(days=>window_days))::integer AS participant_count
    FROM windows
    LEFT JOIN app.contributions contribution
      ON contribution.city_id='10000000-0000-4000-8000-000000000001'::uuid
    GROUP BY window_days
  )
  SELECT
    aggregate.window_days,
    CASE WHEN aggregate.participant_count=0 OR aggregate.participant_count>=5 THEN aggregate.published_count END,
    CASE WHEN aggregate.participant_count=0 OR aggregate.participant_count>=5 THEN aggregate.submitted_count END,
    CASE WHEN aggregate.participant_count=0 OR aggregate.participant_count>=5 THEN (
      SELECT count(*)::integer
      FROM app_private.moderation_cases moderation
      JOIN app.contributions contribution ON contribution.id=moderation.contribution_id
      WHERE contribution.city_id='10000000-0000-4000-8000-000000000001'::uuid
        AND moderation.resolved_at>statement_timestamp()-make_interval(days=>aggregate.window_days)
    ) END,
    aggregate.participant_count BETWEEN 1 AND 4
  FROM aggregate
  ORDER BY aggregate.window_days;
$function$;

REVOKE ALL ON FUNCTION app_private.community_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.zone_leaderboard() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.activity_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.community_stats() TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.zone_leaderboard() TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.activity_summary() TO rutaviva_runtime;
