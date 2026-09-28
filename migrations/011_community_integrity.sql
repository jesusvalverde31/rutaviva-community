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
      contribution.status = 'published'
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
DECLARE
  actor_id uuid;
  existing app.contributions%ROWTYPE;
  created app.contributions%ROWTYPE;
  requested_geometry extensions.geometry(Geometry, 4326);
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication_required'; END IF;
  requested_geometry := extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text), 4326);
  SELECT contribution.* INTO existing FROM app.contributions contribution WHERE contribution.id = p_id;
  IF FOUND THEN
    IF existing.author_id <> actor_id
      OR existing.city_id <> p_city_id
      OR existing.zone_id IS DISTINCT FROM p_zone_id
      OR existing.kind <> p_kind
      OR existing.title <> trim(p_title)
      OR existing.description <> trim(coalesce(p_description, ''))
      OR NOT extensions.ST_Equals(existing.geometry, requested_geometry)
    THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'idempotency_conflict';
    END IF;
    RETURN QUERY SELECT existing.id, existing.status, existing.version;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contribution-create:' || actor_id::text, 0));
  IF (SELECT count(*) FROM app.contributions contribution WHERE contribution.author_id = actor_id AND contribution.created_at >= clock_timestamp() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'contribution_rate_limited';
  END IF;
  INSERT INTO app.contributions (id, author_id, city_id, zone_id, kind, title, description, geometry)
  VALUES (p_id, actor_id, p_city_id, p_zone_id, p_kind, trim(p_title), trim(coalesce(p_description, '')), requested_geometry)
  RETURNING * INTO created;
  INSERT INTO app_private.contribution_history (contribution_id, actor_id, action, to_status, version)
  VALUES (created.id, actor_id, 'created', created.status, created.version);
  INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
  VALUES (p_request_id, actor_id, 'contribution.created', 'contribution', created.id, jsonb_build_object('kind', created.kind));
  RETURN QUERY SELECT created.id, created.status, created.version;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_contribution(p_session_id uuid, p_id uuid)
RETURNS TABLE (
  id uuid, title text, description text, kind text, status text, zone_name text,
  geometry text, public_alias text, confirmations bigint, rejections bigint,
  version bigint, own boolean, my_reaction text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
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
  WHERE contribution.id = p_id AND (
    contribution.status = 'published'
    OR contribution.author_id = actor.user_id
    OR actor.roles && ARRAY['moderator','administrator']::text[]
  )
  GROUP BY contribution.id, zone.name, account.public_alias, actor.user_id;
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
  IF p_action = 'withdraw' AND before_status = 'submitted' THEN
    UPDATE app_private.moderation_cases moderation
    SET status = 'resolved', version = moderation.version + 1, updated_at = clock_timestamp(), resolved_at = clock_timestamp()
    WHERE moderation.contribution_id = changed.id AND moderation.status = 'pending';
  END IF;
  INSERT INTO app_private.contribution_history (contribution_id, actor_id, action, from_status, to_status, version)
  VALUES (changed.id, actor_id, CASE p_action WHEN 'submit' THEN 'submitted' ELSE 'withdrawn' END, before_status, changed.status, changed.version);
  INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
  VALUES (p_request_id, actor_id, 'contribution.' || p_action, 'contribution', changed.id, jsonb_build_object('status', changed.status));
  RETURN QUERY SELECT changed.id, changed.status, changed.version;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.claim_moderation_case(
  p_session_id uuid, p_case_id uuid, p_expected_version bigint, p_request_id uuid
) RETURNS TABLE (id uuid, status text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; actor_roles text[]; contribution_owner uuid; changed app_private.moderation_cases%ROWTYPE; changed_contribution app.contributions%ROWTYPE;
BEGIN
  SELECT candidate.user_id, candidate.roles INTO actor_id, actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT (coalesce(actor_roles,ARRAY[]::text[]) && ARRAY['moderator','administrator']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='moderation_required'; END IF;
  SELECT contribution.author_id INTO contribution_owner FROM app_private.moderation_cases moderation JOIN app.contributions contribution ON contribution.id=moderation.contribution_id WHERE moderation.id=p_case_id;
  IF contribution_owner=actor_id THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='own_contribution_moderation'; END IF;
  UPDATE app_private.moderation_cases moderation SET status='claimed', claimed_by=actor_id, version=moderation.version+1, updated_at=clock_timestamp()
  WHERE moderation.id=p_case_id AND moderation.status='pending' AND moderation.version=p_expected_version RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='moderation_conflict'; END IF;
  UPDATE app.contributions contribution SET status='under_review', version=contribution.version+1, updated_at=clock_timestamp()
  WHERE contribution.id=changed.contribution_id AND contribution.status='submitted' RETURNING * INTO changed_contribution;
  IF changed_contribution.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='moderation_conflict'; END IF;
  INSERT INTO app_private.contribution_history (contribution_id,actor_id,action,from_status,to_status,version)
  VALUES (changed_contribution.id,actor_id,'claimed','submitted',changed_contribution.status,changed_contribution.version);
  INSERT INTO app_private.audit_events (request_id,actor_id,action,resource_type,resource_id,details) VALUES (p_request_id,actor_id,'moderation.claimed','moderation_case',changed.id,'{}'::jsonb);
  RETURN QUERY SELECT changed.id,changed.status,changed.version;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.decide_moderation_case(
  p_session_id uuid, p_case_id uuid, p_expected_version bigint, p_decision text, p_reason text, p_request_id uuid
) RETURNS TABLE (id uuid, status text, version bigint, contribution_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; actor_roles text[]; contribution_owner uuid; changed app_private.moderation_cases%ROWTYPE; changed_contribution app.contributions%ROWTYPE;
BEGIN
  SELECT candidate.user_id,candidate.roles INTO actor_id,actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT (coalesce(actor_roles,ARRAY[]::text[]) && ARRAY['moderator','administrator']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='moderation_required'; END IF;
  IF p_decision NOT IN ('published','rejected') OR char_length(trim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_moderation_decision'; END IF;
  SELECT contribution.author_id INTO contribution_owner FROM app_private.moderation_cases moderation JOIN app.contributions contribution ON contribution.id=moderation.contribution_id WHERE moderation.id=p_case_id;
  IF contribution_owner=actor_id THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='own_contribution_moderation'; END IF;
  UPDATE app_private.moderation_cases moderation SET status='resolved', version=moderation.version+1, updated_at=clock_timestamp(), resolved_at=clock_timestamp()
  WHERE moderation.id=p_case_id AND moderation.status='claimed' AND moderation.claimed_by=actor_id AND moderation.version=p_expected_version RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='moderation_conflict'; END IF;
  UPDATE app.contributions contribution SET status=p_decision, version=contribution.version+1, updated_at=clock_timestamp(), published_at=CASE WHEN p_decision='published' THEN clock_timestamp() ELSE NULL END
  WHERE contribution.id=changed.contribution_id AND contribution.status='under_review' RETURNING * INTO changed_contribution;
  IF changed_contribution.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='moderation_conflict'; END IF;
  INSERT INTO app_private.moderation_decisions (case_id,moderator_id,decision,reason) VALUES (changed.id,actor_id,p_decision,trim(p_reason));
  INSERT INTO app_private.contribution_history (contribution_id,actor_id,action,from_status,to_status,version) VALUES (changed_contribution.id,actor_id,p_decision,'under_review',p_decision,changed_contribution.version);
  INSERT INTO app_private.audit_events (request_id,actor_id,action,resource_type,resource_id,details) VALUES (p_request_id,actor_id,'moderation.'||p_decision,'moderation_case',changed.id,jsonb_build_object('decision',p_decision));
  RETURN QUERY SELECT changed.id,changed.status,changed.version,changed_contribution.status;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.list_contribution_history(p_session_id uuid, p_id uuid)
RETURNS TABLE (action text, from_status text, to_status text, version bigint, actor_alias text, occurred_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; actor_roles text[]; item_owner uuid; item_status text;
BEGIN
  SELECT candidate.user_id,candidate.roles INTO actor_id,actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  SELECT contribution.author_id, contribution.status INTO item_owner,item_status FROM app.contributions contribution WHERE contribution.id=p_id;
  IF item_owner IS NULL OR NOT (item_status='published' OR item_owner=actor_id OR coalesce(actor_roles,ARRAY[]::text[]) && ARRAY['moderator','administrator']::text[]) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='history_unavailable';
  END IF;
  RETURN QUERY
  SELECT history.action,history.from_status,history.to_status,history.version,account.public_alias,history.occurred_at
  FROM app_private.contribution_history history
  LEFT JOIN app.users account ON account.id=history.actor_id
  WHERE history.contribution_id=p_id
  ORDER BY history.occurred_at,history.id;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.reject_contribution_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='contribution history is append-only';
END;
$function$;

CREATE TRIGGER contribution_history_append_only
BEFORE UPDATE OR DELETE ON app_private.contribution_history
FOR EACH ROW EXECUTE FUNCTION app_private.reject_contribution_history_mutation();

CREATE OR REPLACE FUNCTION app_private.set_contribution_reaction(
  p_session_id uuid, p_id uuid, p_reaction text, p_remove boolean, p_request_id uuid
) RETURNS TABLE (confirmations bigint, rejections bigint, my_reaction text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; owner_id uuid; current_status text; existing_reaction text;
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contribution-reaction:' || actor_id::text, 0));
  SELECT contribution.author_id,contribution.status INTO owner_id,current_status FROM app.contributions contribution WHERE contribution.id=p_id FOR UPDATE;
  IF owner_id IS NULL OR current_status <> 'published' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='reaction_unavailable'; END IF;
  IF owner_id=actor_id THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='own_contribution_reaction'; END IF;
  SELECT reaction.reaction INTO existing_reaction FROM app.contribution_reactions reaction WHERE reaction.contribution_id=p_id AND reaction.user_id=actor_id;
  IF (p_remove AND existing_reaction IS NULL) OR (NOT p_remove AND existing_reaction=p_reaction) THEN
    RETURN QUERY SELECT count(*) FILTER (WHERE reaction.reaction='confirm'),count(*) FILTER (WHERE reaction.reaction='reject'),max(reaction.reaction) FILTER (WHERE reaction.user_id=actor_id)
      FROM app.contribution_reactions reaction WHERE reaction.contribution_id=p_id;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM app_private.audit_events event WHERE event.actor_id=actor_id AND event.action IN ('contribution.reaction_set','contribution.reaction_removed') AND event.occurred_at>=clock_timestamp()-interval '1 day') >= 30 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='reaction_rate_limited';
  END IF;
  IF p_remove THEN
    DELETE FROM app.contribution_reactions reaction WHERE reaction.contribution_id=p_id AND reaction.user_id=actor_id;
  ELSE
    IF p_reaction NOT IN ('confirm','reject') THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_reaction'; END IF;
    INSERT INTO app.contribution_reactions (contribution_id,user_id,reaction) VALUES (p_id,actor_id,p_reaction)
    ON CONFLICT (contribution_id,user_id) DO UPDATE SET reaction=excluded.reaction,updated_at=clock_timestamp();
  END IF;
  INSERT INTO app_private.contribution_history (contribution_id,actor_id,action,from_status,to_status,version)
    SELECT contribution.id,actor_id,CASE WHEN p_remove THEN 'reaction_removed' ELSE 'reaction_set' END,contribution.status,contribution.status,contribution.version FROM app.contributions contribution WHERE contribution.id=p_id;
  INSERT INTO app_private.audit_events (request_id,actor_id,action,resource_type,resource_id,details)
    VALUES (p_request_id,actor_id,CASE WHEN p_remove THEN 'contribution.reaction_removed' ELSE 'contribution.reaction_set' END,'contribution',p_id,'{}'::jsonb);
  RETURN QUERY SELECT count(*) FILTER (WHERE reaction.reaction='confirm'),count(*) FILTER (WHERE reaction.reaction='reject'),max(reaction.reaction) FILTER (WHERE reaction.user_id=actor_id)
    FROM app.contribution_reactions reaction WHERE reaction.contribution_id=p_id;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.get_contribution(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.list_contribution_history(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.reject_contribution_history_mutation() FROM PUBLIC, rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.get_contribution(uuid,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.list_contribution_history(uuid,uuid) TO rutaviva_runtime;
