CREATE TABLE app.contributions (
  id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  city_id uuid NOT NULL REFERENCES app.cities(id) ON DELETE RESTRICT,
  zone_id uuid REFERENCES app.zones(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('shortcut', 'accessible', 'barrier', 'closure', 'lighting')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  geometry extensions.geometry(Geometry, 4326) NOT NULL,
  distance_meters numeric(10,2) NOT NULL DEFAULT 0 CHECK (distance_meters BETWEEN 0 AND 5000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'under_review', 'published', 'rejected', 'withdrawn')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  submitted_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extensions.ST_IsValid(geometry)),
  CHECK (extensions.ST_GeometryType(geometry) IN ('ST_Point', 'ST_LineString')),
  CHECK (extensions.ST_NPoints(geometry) BETWEEN 1 AND 500)
);

CREATE TABLE app.contribution_reactions (
  contribution_id uuid NOT NULL REFERENCES app.contributions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('confirm', 'reject')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contribution_id, user_id)
);

CREATE TABLE app_private.contribution_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contribution_id uuid NOT NULL REFERENCES app.contributions(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES app.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'submitted', 'withdrawn', 'reaction_set', 'reaction_removed', 'claimed', 'published', 'rejected')),
  from_status text,
  to_status text,
  version bigint NOT NULL CHECK (version > 0),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contributions_public_idx ON app.contributions (status, updated_at DESC, id DESC);
CREATE INDEX contributions_author_idx ON app.contributions (author_id, created_at DESC);
CREATE INDEX contributions_zone_idx ON app.contributions (zone_id, status);
CREATE INDEX contributions_geometry_gist ON app.contributions USING gist (geometry);
CREATE INDEX contribution_history_item_idx ON app_private.contribution_history (contribution_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION app_private.validate_contribution_geometry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  city_boundary extensions.geometry(Polygon, 4326);
  zone_boundary extensions.geometry(MultiPolygon, 4326);
  zone_city uuid;
BEGIN
  SELECT city.boundary INTO city_boundary FROM app.cities city WHERE city.id = NEW.city_id FOR SHARE;
  IF city_boundary IS NULL OR NOT extensions.ST_CoveredBy(NEW.geometry, city_boundary) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contribution geometry must be covered by its city';
  END IF;
  IF NEW.zone_id IS NOT NULL THEN
    SELECT zone.city_id, zone.boundary INTO zone_city, zone_boundary FROM app.zones zone WHERE zone.id = NEW.zone_id FOR SHARE;
    IF zone_city IS DISTINCT FROM NEW.city_id OR NOT extensions.ST_CoveredBy(NEW.geometry, zone_boundary) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contribution geometry must be covered by its zone';
    END IF;
  END IF;
  IF extensions.ST_GeometryType(NEW.geometry) = 'ST_LineString' THEN
    IF NOT extensions.ST_IsSimple(NEW.geometry) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contribution line must be simple';
    END IF;
    NEW.distance_meters := round(extensions.ST_Length(NEW.geometry::extensions.geography), 2);
    IF NEW.distance_meters <= 0 OR NEW.distance_meters > 5000 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'contribution line must be at most 5000 meters';
    END IF;
  ELSE
    NEW.distance_meters := 0;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER contributions_validate_geometry
BEFORE INSERT OR UPDATE OF city_id, zone_id, geometry ON app.contributions
FOR EACH ROW EXECUTE FUNCTION app_private.validate_contribution_geometry();

CREATE OR REPLACE FUNCTION app_private.contribution_actor(p_session_id uuid)
RETURNS TABLE (user_id uuid, roles text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT account.id,
         coalesce(array_agg(role.role_code ORDER BY role.role_code) FILTER (WHERE role.revoked_at IS NULL), ARRAY[]::text[])
  FROM app_private.sessions session
  JOIN app.users account ON account.id = session.user_id
  LEFT JOIN app.user_roles role ON role.user_id = account.id
  WHERE session.id = p_session_id AND session.revoked_at IS NULL
    AND session.expires_at > clock_timestamp() AND session.idle_expires_at > clock_timestamp()
    AND account.status = 'active'
  GROUP BY account.id;
$function$;

CREATE OR REPLACE FUNCTION app_private.list_contributions(
  p_session_id uuid, p_q text, p_status text, p_kind text, p_limit integer
) RETURNS TABLE (
  id uuid, title text, description text, kind text, status text, zone_name text,
  geometry text, public_alias text, confirmations bigint, rejections bigint,
  version bigint, own boolean, my_reaction text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH actor AS (SELECT * FROM app_private.contribution_actor(p_session_id))
  SELECT contribution.id, contribution.title, contribution.description, contribution.kind, contribution.status,
         zone.name, extensions.ST_AsGeoJSON(contribution.geometry, 6), account.public_alias,
         count(reaction.*) FILTER (WHERE reaction.reaction = 'confirm'),
         count(reaction.*) FILTER (WHERE reaction.reaction = 'reject'), contribution.version,
         contribution.author_id = actor.user_id,
         max(reaction.reaction) FILTER (WHERE reaction.user_id = actor.user_id),
         contribution.created_at, contribution.updated_at
  FROM app.contributions contribution
  JOIN app.users account ON account.id = contribution.author_id
  LEFT JOIN app.zones zone ON zone.id = contribution.zone_id
  LEFT JOIN app.contribution_reactions reaction ON reaction.contribution_id = contribution.id
  LEFT JOIN actor ON true
  WHERE (
      contribution.status IN ('submitted', 'under_review', 'published')
      OR contribution.author_id = actor.user_id
      OR actor.roles && ARRAY['moderator','administrator']::text[]
    )
    AND (p_status IS NULL OR contribution.status = p_status)
    AND (p_kind IS NULL OR contribution.kind = p_kind)
    AND (p_q IS NULL OR contribution.title ILIKE '%' || p_q || '%' OR contribution.description ILIKE '%' || p_q || '%' OR zone.name ILIKE '%' || p_q || '%')
  GROUP BY contribution.id, zone.name, account.public_alias, actor.user_id
  ORDER BY contribution.updated_at DESC, contribution.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 100));
$function$;

CREATE OR REPLACE FUNCTION app_private.create_contribution(
  p_session_id uuid, p_id uuid, p_city_id uuid, p_zone_id uuid, p_kind text,
  p_title text, p_description text, p_geometry jsonb, p_request_id uuid
) RETURNS TABLE (id uuid, status text, version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; existing app.contributions%ROWTYPE; created app.contributions%ROWTYPE;
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required'; END IF;
  SELECT contribution.* INTO existing FROM app.contributions contribution WHERE contribution.id = p_id;
  IF FOUND THEN
    IF existing.author_id <> actor_id THEN RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'idempotency_conflict'; END IF;
    RETURN QUERY SELECT existing.id, existing.status, existing.version; RETURN;
  END IF;
  IF (SELECT count(*) FROM app.contributions contribution WHERE contribution.author_id = actor_id AND contribution.created_at >= clock_timestamp() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'contribution_rate_limited';
  END IF;
  INSERT INTO app.contributions (id, author_id, city_id, zone_id, kind, title, description, geometry)
  VALUES (p_id, actor_id, p_city_id, p_zone_id, p_kind, trim(p_title), trim(coalesce(p_description, '')), extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text), 4326))
  RETURNING * INTO created;
  INSERT INTO app_private.contribution_history (contribution_id, actor_id, action, to_status, version)
  VALUES (created.id, actor_id, 'created', created.status, created.version);
  INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
  VALUES (p_request_id, actor_id, 'contribution.created', 'contribution', created.id, jsonb_build_object('kind', created.kind));
  RETURN QUERY SELECT created.id, created.status, created.version;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.update_contribution(
  p_session_id uuid, p_id uuid, p_expected_version bigint, p_title text,
  p_description text, p_geometry jsonb, p_request_id uuid
) RETURNS TABLE (id uuid, status text, version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; changed app.contributions%ROWTYPE;
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  UPDATE app.contributions contribution SET title = trim(p_title), description = trim(coalesce(p_description, '')),
    geometry = extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text), 4326),
    version = contribution.version + 1, updated_at = clock_timestamp()
  WHERE contribution.id = p_id AND contribution.author_id = actor_id AND contribution.status = 'draft'
    AND contribution.version = p_expected_version RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'contribution_conflict'; END IF;
  INSERT INTO app_private.contribution_history (contribution_id, actor_id, action, from_status, to_status, version)
  VALUES (changed.id, actor_id, 'updated', changed.status, changed.status, changed.version);
  RETURN QUERY SELECT changed.id, changed.status, changed.version;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.transition_own_contribution(
  p_session_id uuid, p_id uuid, p_expected_version bigint, p_action text, p_request_id uuid
) RETURNS TABLE (id uuid, status text, version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; before_status text; changed app.contributions%ROWTYPE; target_status text;
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  target_status := CASE p_action WHEN 'submit' THEN 'submitted' WHEN 'withdraw' THEN 'withdrawn' ELSE NULL END;
  IF target_status IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_transition'; END IF;
  SELECT contribution.status INTO before_status FROM app.contributions contribution
    WHERE contribution.id = p_id AND contribution.author_id = actor_id FOR UPDATE;
  IF (p_action = 'submit' AND before_status <> 'draft') OR (p_action = 'withdraw' AND before_status NOT IN ('draft','submitted')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_transition';
  END IF;
  UPDATE app.contributions contribution SET status = target_status, version = contribution.version + 1,
    submitted_at = CASE WHEN target_status = 'submitted' THEN clock_timestamp() ELSE contribution.submitted_at END,
    updated_at = clock_timestamp()
  WHERE contribution.id = p_id AND contribution.author_id = actor_id AND contribution.version = p_expected_version
  RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'contribution_conflict'; END IF;
  INSERT INTO app_private.contribution_history (contribution_id, actor_id, action, from_status, to_status, version)
  VALUES (changed.id, actor_id, CASE p_action WHEN 'submit' THEN 'submitted' ELSE 'withdrawn' END, before_status, changed.status, changed.version);
  INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
  VALUES (p_request_id, actor_id, 'contribution.' || p_action, 'contribution', changed.id, jsonb_build_object('status', changed.status));
  RETURN QUERY SELECT changed.id, changed.status, changed.version;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.set_contribution_reaction(
  p_session_id uuid, p_id uuid, p_reaction text, p_remove boolean, p_request_id uuid
) RETURNS TABLE (confirmations bigint, rejections bigint, my_reaction text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; owner_id uuid; current_status text;
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required'; END IF;
  SELECT contribution.author_id, contribution.status INTO owner_id, current_status FROM app.contributions contribution WHERE contribution.id = p_id FOR UPDATE;
  IF owner_id IS NULL OR current_status NOT IN ('submitted','under_review','published') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'reaction_unavailable'; END IF;
  IF owner_id = actor_id THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'own_contribution_reaction'; END IF;
  IF (SELECT count(*) FROM app_private.audit_events event WHERE event.actor_id = actor_id AND event.action IN ('contribution.reaction_set','contribution.reaction_removed') AND event.occurred_at >= clock_timestamp() - interval '1 day') >= 30 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'reaction_rate_limited';
  END IF;
  IF p_remove THEN DELETE FROM app.contribution_reactions reaction WHERE reaction.contribution_id = p_id AND reaction.user_id = actor_id;
  ELSE
    IF p_reaction NOT IN ('confirm','reject') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_reaction'; END IF;
    INSERT INTO app.contribution_reactions (contribution_id, user_id, reaction) VALUES (p_id, actor_id, p_reaction)
    ON CONFLICT (contribution_id, user_id) DO UPDATE SET reaction = excluded.reaction, updated_at = clock_timestamp();
  END IF;
  INSERT INTO app_private.contribution_history (contribution_id, actor_id, action, from_status, to_status, version)
  SELECT contribution.id, actor_id, CASE WHEN p_remove THEN 'reaction_removed' ELSE 'reaction_set' END, contribution.status, contribution.status, contribution.version
  FROM app.contributions contribution WHERE contribution.id = p_id;
  INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
  VALUES (p_request_id, actor_id, CASE WHEN p_remove THEN 'contribution.reaction_removed' ELSE 'contribution.reaction_set' END, 'contribution', p_id, '{}'::jsonb);
  RETURN QUERY SELECT count(*) FILTER (WHERE reaction.reaction='confirm'), count(*) FILTER (WHERE reaction.reaction='reject'),
    max(reaction.reaction) FILTER (WHERE reaction.user_id=actor_id)
  FROM app.contribution_reactions reaction WHERE reaction.contribution_id=p_id;
END;
$function$;

REVOKE ALL ON app.contributions, app.contribution_reactions FROM PUBLIC, rutaviva_runtime;
REVOKE ALL ON app_private.contribution_history FROM PUBLIC, rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.contribution_actor(uuid) FROM PUBLIC, rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.list_contributions(uuid,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.create_contribution(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.update_contribution(uuid,uuid,bigint,text,text,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.transition_own_contribution(uuid,uuid,bigint,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.set_contribution_reaction(uuid,uuid,text,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.list_contributions(uuid,text,text,text,integer) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.create_contribution(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.update_contribution(uuid,uuid,bigint,text,text,jsonb,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.transition_own_contribution(uuid,uuid,bigint,text,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.set_contribution_reaction(uuid,uuid,text,boolean,uuid) TO rutaviva_runtime;
