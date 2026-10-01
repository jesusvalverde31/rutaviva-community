-- Bloque 31: datos observables de accesibilidad. Migración aditiva y compatible.
ALTER TABLE app.contributions
  ADD COLUMN condition_type text NOT NULL DEFAULT 'other',
  ADD COLUMN affected_groups text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN observed_on date,
  ADD COLUMN permanence text NOT NULL DEFAULT 'unknown',
  ADD COLUMN measurement_status text NOT NULL DEFAULT 'unmeasured',
  ADD COLUMN clear_width_cm integer,
  ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'open',
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN personal_data_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE app.contributions
  ADD CONSTRAINT contributions_condition_type_check CHECK (condition_type IN ('narrow_passage','step_or_curb','damaged_surface','difficult_slope','orientation','crossing','temporary_block','poor_lighting','favorable_segment','other')),
  ADD CONSTRAINT contributions_affected_groups_check CHECK (affected_groups <@ ARRAY['wheelchair','reduced_mobility','visual','older_people','stroller','general']::text[] AND cardinality(affected_groups)<=6),
  ADD CONSTRAINT contributions_permanence_check CHECK (permanence IN ('permanent','temporary','unknown')),
  ADD CONSTRAINT contributions_measurement_status_check CHECK (measurement_status IN ('unmeasured','estimated','measured')),
  ADD CONSTRAINT contributions_clear_width_check CHECK (clear_width_cm IS NULL OR (clear_width_cm BETWEEN 20 AND 1000 AND measurement_status IN ('estimated','measured'))),
  ADD CONSTRAINT contributions_lifecycle_check CHECK (lifecycle_status IN ('open','resolved') AND ((lifecycle_status='resolved' AND resolved_at IS NOT NULL) OR (lifecycle_status='open' AND resolved_at IS NULL)));

CREATE INDEX contributions_accessibility_filters_idx ON app.contributions(condition_type,lifecycle_status,observed_on DESC,updated_at DESC);

ALTER TABLE app_private.contribution_history DROP CONSTRAINT contribution_history_action_check;
ALTER TABLE app_private.contribution_history ADD CONSTRAINT contribution_history_action_check
  CHECK (action IN ('created','updated','submitted','withdrawn','reaction_set','reaction_removed','claimed','published','rejected','resolved','reopened'));

CREATE OR REPLACE FUNCTION app_private.validate_accessibility_details(
  p_kind text,p_geometry jsonb,p_condition_type text,p_affected_groups text[],p_observed_on date,p_permanence text,
  p_measurement_status text,p_clear_width_cm integer,p_lifecycle_status text,p_personal_data_confirmed boolean
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $function$
DECLARE geometry_type text;
BEGIN
  geometry_type:=p_geometry->>'type';
  IF p_kind NOT IN ('accessible','barrier','closure','lighting')
    OR p_condition_type NOT IN ('narrow_passage','step_or_curb','damaged_surface','difficult_slope','orientation','crossing','temporary_block','poor_lighting','favorable_segment','other')
    OR p_permanence NOT IN ('permanent','temporary','unknown') OR p_measurement_status NOT IN ('unmeasured','estimated','measured')
    OR p_lifecycle_status<>'open' OR p_affected_groups IS NULL
    OR NOT p_affected_groups <@ ARRAY['wheelchair','reduced_mobility','visual','older_people','stroller','general']::text[] OR cardinality(p_affected_groups)>6
    OR p_observed_on IS NULL OR p_observed_on>current_date OR p_observed_on<current_date-interval '2 years'
    OR p_personal_data_confirmed IS DISTINCT FROM true
    OR (p_clear_width_cm IS NOT NULL AND (p_clear_width_cm<20 OR p_clear_width_cm>1000 OR p_measurement_status='unmeasured'))
    OR (p_condition_type='favorable_segment' AND (p_kind<>'accessible' OR geometry_type<>'LineString'))
    OR (p_condition_type='poor_lighting' AND (p_kind<>'lighting' OR geometry_type<>'Point'))
    OR (p_condition_type='temporary_block' AND (p_kind<>'closure' OR geometry_type<>'Point'))
    OR (p_condition_type NOT IN ('favorable_segment','poor_lighting','temporary_block') AND (p_kind<>'barrier' OR geometry_type<>'Point'))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_accessibility_details'; END IF;
END;$function$;

CREATE OR REPLACE FUNCTION app_private.create_contribution(
  p_session_id uuid,p_id uuid,p_city_id uuid,p_zone_id uuid,p_kind text,p_title text,p_description text,p_geometry jsonb,p_request_id uuid
) RETURNS TABLE(id uuid,status text,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;existing app.contributions%ROWTYPE;created app.contributions%ROWTYPE;requested_geometry extensions.geometry(Geometry,4326);
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication_required'; END IF;
  IF p_kind<>'shortcut' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='accessibility_details_required'; END IF;
  requested_geometry:=extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text),4326);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contribution-create:'||p_id::text,0));
  SELECT contribution.* INTO existing FROM app.contributions contribution WHERE contribution.id=p_id;
  IF FOUND THEN
    IF existing.author_id<>actor_id OR existing.city_id<>p_city_id OR existing.zone_id IS DISTINCT FROM p_zone_id OR existing.kind<>p_kind
      OR existing.title<>trim(p_title) OR existing.description<>trim(coalesce(p_description,'')) OR NOT extensions.ST_Equals(existing.geometry,requested_geometry)
    THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict'; END IF;
    RETURN QUERY SELECT existing.id,existing.status,existing.version;RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contribution-rate:'||actor_id::text,0));
  IF (SELECT count(*) FROM app.contributions contribution WHERE contribution.author_id=actor_id AND contribution.created_at>=clock_timestamp()-interval '1 day')>=5
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='contribution_rate_limited'; END IF;
  INSERT INTO app.contributions(id,author_id,city_id,zone_id,kind,title,description,geometry)
    VALUES(p_id,actor_id,p_city_id,p_zone_id,p_kind,trim(p_title),trim(coalesce(p_description,'')),requested_geometry) RETURNING * INTO created;
  INSERT INTO app_private.contribution_history(contribution_id,actor_id,action,to_status,version) VALUES(created.id,actor_id,'created',created.status,created.version);
  INSERT INTO app_private.audit_events(request_id,actor_id,action,resource_type,resource_id,details) VALUES(p_request_id,actor_id,'contribution.created','contribution',created.id,jsonb_build_object('kind',created.kind));
  RETURN QUERY SELECT created.id,created.status,created.version;
END;$function$;

CREATE FUNCTION app_private.create_accessibility_contribution(
  p_session_id uuid,p_id uuid,p_city_id uuid,p_zone_id uuid,p_kind text,p_title text,p_description text,p_geometry jsonb,
  p_condition_type text,p_affected_groups text[],p_observed_on date,p_permanence text,p_measurement_status text,
  p_clear_width_cm integer,p_personal_data_confirmed boolean,p_request_id uuid
) RETURNS TABLE(id uuid,status text,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;existing app.contributions%ROWTYPE;created app.contributions%ROWTYPE;requested_geometry extensions.geometry(Geometry,4326);
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication_required'; END IF;
  PERFORM app_private.validate_accessibility_details(p_kind,p_geometry,p_condition_type,p_affected_groups,p_observed_on,p_permanence,p_measurement_status,p_clear_width_cm,'open',p_personal_data_confirmed);
  requested_geometry:=extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text),4326);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contribution-create:'||p_id::text,0));
  SELECT contribution.* INTO existing FROM app.contributions contribution WHERE contribution.id=p_id;
  IF FOUND THEN
    IF existing.author_id<>actor_id OR existing.city_id<>p_city_id OR existing.zone_id IS DISTINCT FROM p_zone_id OR existing.kind<>p_kind
      OR existing.title<>trim(p_title) OR existing.description<>trim(coalesce(p_description,'')) OR NOT extensions.ST_Equals(existing.geometry,requested_geometry)
      OR existing.condition_type<>p_condition_type OR existing.affected_groups<>p_affected_groups OR existing.observed_on<>p_observed_on
      OR existing.permanence<>p_permanence OR existing.measurement_status<>p_measurement_status OR existing.clear_width_cm IS DISTINCT FROM p_clear_width_cm
      OR existing.personal_data_confirmed<>p_personal_data_confirmed
    THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict'; END IF;
    RETURN QUERY SELECT existing.id,existing.status,existing.version;RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contribution-rate:'||actor_id::text,0));
  IF (SELECT count(*) FROM app.contributions contribution WHERE contribution.author_id=actor_id AND contribution.created_at>=clock_timestamp()-interval '1 day')>=5
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='contribution_rate_limited'; END IF;
  INSERT INTO app.contributions(id,author_id,city_id,zone_id,kind,title,description,geometry,condition_type,affected_groups,observed_on,permanence,measurement_status,clear_width_cm,personal_data_confirmed)
  VALUES(p_id,actor_id,p_city_id,p_zone_id,p_kind,trim(p_title),trim(coalesce(p_description,'')),requested_geometry,p_condition_type,p_affected_groups,p_observed_on,p_permanence,p_measurement_status,p_clear_width_cm,p_personal_data_confirmed) RETURNING * INTO created;
  INSERT INTO app_private.contribution_history(contribution_id,actor_id,action,to_status,version) VALUES(created.id,actor_id,'created',created.status,created.version);
  INSERT INTO app_private.audit_events(request_id,actor_id,action,resource_type,resource_id,details) VALUES(p_request_id,actor_id,'contribution.created','contribution',created.id,jsonb_build_object('kind',created.kind,'conditionType',created.condition_type));
  RETURN QUERY SELECT created.id,created.status,created.version;
END;$function$;

CREATE OR REPLACE FUNCTION app_private.update_contribution(
  p_session_id uuid,p_id uuid,p_expected_version bigint,p_title text,p_description text,p_geometry jsonb,p_request_id uuid
) RETURNS TABLE(id uuid,status text,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;changed app.contributions%ROWTYPE;
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  UPDATE app.contributions contribution SET title=trim(p_title),description=trim(coalesce(p_description,'')),
    geometry=extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text),4326),version=contribution.version+1,updated_at=clock_timestamp()
  WHERE contribution.id=p_id AND contribution.author_id=actor_id AND contribution.status='draft' AND contribution.kind='shortcut'
    AND contribution.version=p_expected_version RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='contribution_conflict'; END IF;
  INSERT INTO app_private.contribution_history(contribution_id,actor_id,action,from_status,to_status,version)
    VALUES(changed.id,actor_id,'updated',changed.status,changed.status,changed.version);
  INSERT INTO app_private.audit_events(request_id,actor_id,action,resource_type,resource_id,details)
    VALUES(p_request_id,actor_id,'contribution.updated','contribution',changed.id,'{}'::jsonb);
  RETURN QUERY SELECT changed.id,changed.status,changed.version;
END;$function$;

CREATE FUNCTION app_private.update_accessibility_contribution(
  p_session_id uuid,p_id uuid,p_expected_version bigint,p_kind text,p_title text,p_description text,p_geometry jsonb,
  p_condition_type text,p_affected_groups text[],p_observed_on date,p_permanence text,p_measurement_status text,
  p_clear_width_cm integer,p_personal_data_confirmed boolean,p_request_id uuid
) RETURNS TABLE(id uuid,status text,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;changed app.contributions%ROWTYPE;requested_geometry extensions.geometry(Geometry,4326);
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication_required'; END IF;
  PERFORM app_private.validate_accessibility_details(p_kind,p_geometry,p_condition_type,p_affected_groups,p_observed_on,p_permanence,p_measurement_status,p_clear_width_cm,'open',p_personal_data_confirmed);
  requested_geometry:=extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text),4326);
  UPDATE app.contributions contribution SET
    kind=p_kind,title=trim(p_title),description=trim(coalesce(p_description,'')),geometry=requested_geometry,
    condition_type=p_condition_type,affected_groups=p_affected_groups,observed_on=p_observed_on,permanence=p_permanence,
    measurement_status=p_measurement_status,clear_width_cm=p_clear_width_cm,personal_data_confirmed=p_personal_data_confirmed,
    version=contribution.version+1,updated_at=clock_timestamp()
  WHERE contribution.id=p_id AND contribution.author_id=actor_id AND contribution.status='draft'
    AND contribution.lifecycle_status='open' AND contribution.version=p_expected_version
  RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='contribution_conflict'; END IF;
  INSERT INTO app_private.contribution_history(contribution_id,actor_id,action,from_status,to_status,version)
    VALUES(changed.id,actor_id,'updated',changed.status,changed.status,changed.version);
  INSERT INTO app_private.audit_events(request_id,actor_id,action,resource_type,resource_id,details)
    VALUES(p_request_id,actor_id,'contribution.updated','contribution',changed.id,jsonb_build_object('kind',changed.kind,'conditionType',changed.condition_type));
  RETURN QUERY SELECT changed.id,changed.status,changed.version;
END;$function$;

CREATE FUNCTION app_private.list_accessibility_contributions(
  p_session_id uuid,p_q text,p_status text,p_kind text,p_condition_type text,p_lifecycle_status text,p_affected_group text,p_limit integer
) RETURNS TABLE(id uuid,title text,description text,kind text,status text,zone_name text,geometry text,public_alias text,confirmations bigint,rejections bigint,version bigint,own boolean,my_reaction text,created_at timestamptz,updated_at timestamptz,condition_type text,affected_groups text[],observed_on date,permanence text,measurement_status text,clear_width_cm integer,lifecycle_status text,resolved_at timestamptz,personal_data_confirmed boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  WITH actor AS(SELECT * FROM app_private.contribution_actor(p_session_id))
  SELECT contribution.id,contribution.title,contribution.description,contribution.kind,contribution.status,zone.name,extensions.ST_AsGeoJSON(contribution.geometry,6),account.public_alias,
    count(reaction.*) FILTER(WHERE reaction.reaction='confirm'),count(reaction.*) FILTER(WHERE reaction.reaction='reject'),contribution.version,contribution.author_id=actor.user_id,
    max(reaction.reaction) FILTER(WHERE reaction.user_id=actor.user_id),contribution.created_at,contribution.updated_at,contribution.condition_type,contribution.affected_groups,
    contribution.observed_on,contribution.permanence,contribution.measurement_status,contribution.clear_width_cm,contribution.lifecycle_status,contribution.resolved_at,contribution.personal_data_confirmed
  FROM app.contributions contribution JOIN app.users account ON account.id=contribution.author_id LEFT JOIN app.zones zone ON zone.id=contribution.zone_id
  LEFT JOIN app.contribution_reactions reaction ON reaction.contribution_id=contribution.id LEFT JOIN actor ON true
  WHERE (contribution.status='published' OR contribution.author_id=actor.user_id OR actor.roles&&ARRAY['moderator','administrator']::text[])
    AND (p_status IS NULL OR contribution.status=p_status) AND (p_kind IS NULL OR contribution.kind=p_kind)
    AND (p_condition_type IS NULL OR contribution.condition_type=p_condition_type) AND (p_lifecycle_status IS NULL OR contribution.lifecycle_status=p_lifecycle_status)
    AND (p_affected_group IS NULL OR p_affected_group=ANY(contribution.affected_groups))
    AND (p_q IS NULL OR contribution.title ILIKE '%'||p_q||'%' OR contribution.description ILIKE '%'||p_q||'%' OR zone.name ILIKE '%'||p_q||'%')
  GROUP BY contribution.id,zone.name,account.public_alias,actor.user_id ORDER BY contribution.updated_at DESC,contribution.id DESC LIMIT greatest(1,least(coalesce(p_limit,50),100));
$function$;

CREATE FUNCTION app_private.get_accessibility_contribution(p_session_id uuid,p_id uuid)
RETURNS TABLE(id uuid,title text,description text,kind text,status text,zone_name text,geometry text,public_alias text,confirmations bigint,rejections bigint,version bigint,own boolean,my_reaction text,created_at timestamptz,updated_at timestamptz,condition_type text,affected_groups text[],observed_on date,permanence text,measurement_status text,clear_width_cm integer,lifecycle_status text,resolved_at timestamptz,personal_data_confirmed boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  WITH actor AS(SELECT * FROM app_private.contribution_actor(p_session_id))
  SELECT contribution.id,contribution.title,contribution.description,contribution.kind,contribution.status,zone.name,extensions.ST_AsGeoJSON(contribution.geometry,6),account.public_alias,
    count(reaction.*) FILTER(WHERE reaction.reaction='confirm'),count(reaction.*) FILTER(WHERE reaction.reaction='reject'),contribution.version,contribution.author_id=actor.user_id,
    max(reaction.reaction) FILTER(WHERE reaction.user_id=actor.user_id),contribution.created_at,contribution.updated_at,contribution.condition_type,contribution.affected_groups,
    contribution.observed_on,contribution.permanence,contribution.measurement_status,contribution.clear_width_cm,contribution.lifecycle_status,contribution.resolved_at,contribution.personal_data_confirmed
  FROM app.contributions contribution JOIN app.users account ON account.id=contribution.author_id LEFT JOIN app.zones zone ON zone.id=contribution.zone_id
  LEFT JOIN app.contribution_reactions reaction ON reaction.contribution_id=contribution.id LEFT JOIN actor ON true
  WHERE contribution.id=p_id AND (contribution.status='published' OR contribution.author_id=actor.user_id OR actor.roles&&ARRAY['moderator','administrator']::text[])
  GROUP BY contribution.id,zone.name,account.public_alias,actor.user_id;
$function$;

CREATE TABLE app_private.contribution_lifecycle_requests(
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  contribution_id uuid NOT NULL REFERENCES app.contributions(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('resolve','reopen')),
  expected_version bigint NOT NULL CHECK(expected_version>0),
  request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
  result_lifecycle_status text NOT NULL CHECK(result_lifecycle_status IN ('open','resolved')),
  result_version bigint NOT NULL CHECK(result_version>0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION app_private.set_accessibility_lifecycle(
  p_session_id uuid,p_id uuid,p_expected_version bigint,p_action text,p_reason text,p_request_id uuid,p_request_hash bytea
) RETURNS TABLE(id uuid,lifecycle_status text,version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;actor_roles text[];owner_id uuid;changed app.contributions%ROWTYPE;previous_request app_private.contribution_lifecycle_requests%ROWTYPE;
BEGIN
  SELECT candidate.user_id,candidate.roles INTO actor_id,actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT(coalesce(actor_roles,ARRAY[]::text[])&&ARRAY['moderator','administrator']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='moderation_required'; END IF;
  IF p_request_id IS NULL OR p_expected_version<1 OR p_action NOT IN ('resolve','reopen') OR char_length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 300 OR p_request_hash IS NULL OR octet_length(p_request_hash)<>32
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_lifecycle_request'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contribution-lifecycle:'||p_request_id::text,0));
  SELECT lifecycle_request.* INTO previous_request FROM app_private.contribution_lifecycle_requests lifecycle_request WHERE lifecycle_request.request_id=p_request_id;
  IF FOUND THEN
    IF previous_request.actor_id<>actor_id OR previous_request.contribution_id<>p_id OR previous_request.action<>p_action OR previous_request.expected_version<>p_expected_version OR previous_request.request_hash<>p_request_hash
    THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict'; END IF;
    RETURN QUERY SELECT previous_request.contribution_id,previous_request.result_lifecycle_status,previous_request.result_version;RETURN;
  END IF;
  SELECT contribution.author_id INTO owner_id FROM app.contributions contribution WHERE contribution.id=p_id FOR UPDATE;
  IF owner_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='contribution_conflict'; END IF;
  IF owner_id=actor_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='own_contribution_moderation'; END IF;
  UPDATE app.contributions contribution SET
    lifecycle_status=CASE WHEN p_action='resolve' THEN 'resolved' ELSE 'open' END,
    resolved_at=CASE WHEN p_action='resolve' THEN clock_timestamp() ELSE NULL END,
    version=contribution.version+1,updated_at=clock_timestamp()
  WHERE contribution.id=p_id AND contribution.status='published' AND contribution.version=p_expected_version
    AND ((p_action='resolve' AND contribution.lifecycle_status='open') OR (p_action='reopen' AND contribution.lifecycle_status='resolved'))
  RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='contribution_conflict'; END IF;
  INSERT INTO app_private.contribution_history(contribution_id,actor_id,action,from_status,to_status,version)
    VALUES(changed.id,actor_id,CASE WHEN p_action='resolve' THEN 'resolved' ELSE 'reopened' END,changed.status,changed.status,changed.version);
  INSERT INTO app_private.audit_events(request_id,actor_id,action,resource_type,resource_id,details)
    VALUES(p_request_id,actor_id,'contribution.'||CASE WHEN p_action='resolve' THEN 'resolved' ELSE 'reopened' END,'contribution',changed.id,
      jsonb_build_object('action',p_action,'reasonFingerprint',encode(p_request_hash,'hex')));
  INSERT INTO app_private.contribution_lifecycle_requests(request_id,actor_id,contribution_id,action,expected_version,request_hash,result_lifecycle_status,result_version)
    VALUES(p_request_id,actor_id,changed.id,p_action,p_expected_version,p_request_hash,changed.lifecycle_status,changed.version);
  RETURN QUERY SELECT changed.id,changed.lifecycle_status,changed.version;
END;$function$;

DROP FUNCTION app_private.list_moderation_cases(uuid,text,integer);
CREATE FUNCTION app_private.list_moderation_cases(p_session_id uuid,p_status text,p_limit integer)
RETURNS TABLE(
  id uuid,contribution_id uuid,case_status text,case_version bigint,title text,description text,kind text,contribution_status text,zone_name text,
  geometry text,author_alias text,confirmations bigint,rejections bigint,own_claim boolean,created_at timestamptz,updated_at timestamptz,
  condition_type text,affected_groups text[],observed_on date,permanence text,measurement_status text,clear_width_cm integer,
  lifecycle_status text,resolved_at timestamptz,personal_data_confirmed boolean,contribution_version bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;actor_roles text[];
BEGIN
  SELECT candidate.user_id,candidate.roles INTO actor_id,actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT(coalesce(actor_roles,ARRAY[]::text[])&&ARRAY['moderator','administrator']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='moderation_required'; END IF;
  RETURN QUERY SELECT moderation.id,moderation.contribution_id,moderation.status,moderation.version,
    contribution.title,contribution.description,contribution.kind,contribution.status,zone.name,extensions.ST_AsGeoJSON(contribution.geometry,6),account.public_alias,
    count(reaction.*) FILTER(WHERE reaction.reaction='confirm'),count(reaction.*) FILTER(WHERE reaction.reaction='reject'),
    moderation.claimed_by=actor_id,moderation.created_at,moderation.updated_at,contribution.condition_type,contribution.affected_groups,
    contribution.observed_on,contribution.permanence,contribution.measurement_status,contribution.clear_width_cm,contribution.lifecycle_status,
    contribution.resolved_at,contribution.personal_data_confirmed,contribution.version
  FROM app_private.moderation_cases moderation JOIN app.contributions contribution ON contribution.id=moderation.contribution_id
  JOIN app.users account ON account.id=contribution.author_id LEFT JOIN app.zones zone ON zone.id=contribution.zone_id
  LEFT JOIN app.contribution_reactions reaction ON reaction.contribution_id=contribution.id
  WHERE p_status IS NULL OR moderation.status=p_status
  GROUP BY moderation.id,contribution.id,zone.name,account.public_alias,actor_id
  ORDER BY moderation.created_at,moderation.id LIMIT greatest(1,least(coalesce(p_limit,50),100));
END;$function$;

CREATE OR REPLACE FUNCTION app_private.get_route_network(
  p_origin_longitude double precision,p_origin_latitude double precision,p_destination_longitude double precision,p_destination_latitude double precision,p_max_snap_meters double precision
) RETURNS TABLE(
  release_id uuid,release_version text,osm_date date,imported_at timestamptz,origin_node_id uuid,origin_offset_meters double precision,
  destination_node_id uuid,destination_offset_meters double precision,segment_id uuid,source_node_id uuid,target_node_id uuid,segment_name text,
  distance_meters numeric,accessibility_status text,lighting_status text,geometry text,source_latitude double precision,source_longitude double precision,
  target_latitude double precision,target_longitude double precision,contributions jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE selected_release app.network_releases%ROWTYPE;zone_boundary extensions.geometry(MultiPolygon,4326);origin_point extensions.geometry(Point,4326);destination_point extensions.geometry(Point,4326);nearest_origin record;nearest_destination record;
BEGIN
  IF p_max_snap_meters<=0 OR p_max_snap_meters>75 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_snap_distance'; END IF;
  origin_point:=extensions.ST_SetSRID(extensions.ST_MakePoint(p_origin_longitude,p_origin_latitude),4326);
  destination_point:=extensions.ST_SetSRID(extensions.ST_MakePoint(p_destination_longitude,p_destination_latitude),4326);
  SELECT zone.boundary INTO zone_boundary FROM app.zones zone WHERE zone.id='20000000-0000-4000-8000-000000000001'::uuid AND zone.is_active;
  IF zone_boundary IS NULL OR NOT extensions.ST_CoveredBy(origin_point,zone_boundary) OR NOT extensions.ST_CoveredBy(destination_point,zone_boundary) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='outside_pilot'; END IF;
  SELECT release.* INTO selected_release FROM app.network_releases release WHERE release.zone_id='20000000-0000-4000-8000-000000000001'::uuid AND release.status='published' ORDER BY release.published_at DESC,release.id LIMIT 1;
  IF selected_release.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='routing_data_not_ready'; END IF;
  SELECT node.id,extensions.ST_Distance(node.position::extensions.geography,origin_point::extensions.geography) AS offset_meters INTO nearest_origin
    FROM app.route_nodes node WHERE node.release_id=selected_release.id AND node.is_published AND extensions.ST_DWithin(node.position::extensions.geography,origin_point::extensions.geography,p_max_snap_meters) ORDER BY node.position<->origin_point,node.id LIMIT 1;
  SELECT node.id,extensions.ST_Distance(node.position::extensions.geography,destination_point::extensions.geography) AS offset_meters INTO nearest_destination
    FROM app.route_nodes node WHERE node.release_id=selected_release.id AND node.is_published AND extensions.ST_DWithin(node.position::extensions.geography,destination_point::extensions.geography,p_max_snap_meters) ORDER BY node.position<->destination_point,node.id LIMIT 1;
  IF nearest_origin.id IS NULL OR nearest_destination.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='no_nearby_network'; END IF;
  RETURN QUERY SELECT selected_release.id,selected_release.version,selected_release.source_date,selected_release.imported_at,
    nearest_origin.id,nearest_origin.offset_meters,nearest_destination.id,nearest_destination.offset_meters,segment.id,segment.source_node_id,segment.target_node_id,segment.name,
    segment.distance_meters,segment.accessibility_status,segment.lighting_status,extensions.ST_AsGeoJSON(segment.geometry,6),
    extensions.ST_Y(source.position),extensions.ST_X(source.position),extensions.ST_Y(target.position),extensions.ST_X(target.position),coalesce(impact.items,'[]'::jsonb)
  FROM app.route_segments segment JOIN app.route_nodes source ON source.id=segment.source_node_id AND source.release_id=selected_release.id AND source.is_published
  JOIN app.route_nodes target ON target.id=segment.target_node_id AND target.release_id=selected_release.id AND target.is_published
  LEFT JOIN LATERAL(
    SELECT jsonb_agg(jsonb_build_object('kind',item.kind,'title',item.title,'status',item.status,'confidence',item.confidence,'measurementStatus',item.measurement_status,'lifecycleStatus',item.lifecycle_status) ORDER BY item.id) AS items
    FROM(
      SELECT contribution.id,contribution.kind,contribution.title,contribution.status,contribution.measurement_status,contribution.lifecycle_status,
        least(1.0,greatest(0.0,0.5+0.1*count(reaction.*) FILTER(WHERE reaction.reaction='confirm')-0.15*count(reaction.*) FILTER(WHERE reaction.reaction='reject'))) AS confidence
      FROM app.contributions contribution LEFT JOIN app.contribution_reactions reaction ON reaction.contribution_id=contribution.id
      WHERE contribution.status='published' AND contribution.routing_disputed=false AND contribution.routing_valid_until>statement_timestamp()
        AND contribution.city_id=selected_release.city_id AND app_private.contribution_affects_segment(contribution.geometry,segment.geometry,segment.distance_meters)
      GROUP BY contribution.id
    ) item
  ) impact ON true WHERE segment.release_id=selected_release.id AND segment.is_published ORDER BY segment.id;
END;$function$;

REVOKE ALL ON app_private.contribution_lifecycle_requests FROM PUBLIC,rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.validate_accessibility_details(text,jsonb,text,text[],date,text,text,integer,text,boolean) FROM PUBLIC,rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.create_contribution(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.create_accessibility_contribution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text[],date,text,text,integer,boolean,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.update_contribution(uuid,uuid,bigint,text,text,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.update_accessibility_contribution(uuid,uuid,bigint,text,text,text,jsonb,text,text[],date,text,text,integer,boolean,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.list_accessibility_contributions(uuid,text,text,text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.get_accessibility_contribution(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.set_accessibility_lifecycle(uuid,uuid,bigint,text,text,uuid,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.list_moderation_cases(uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.get_route_network(double precision,double precision,double precision,double precision,double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.create_accessibility_contribution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text[],date,text,text,integer,boolean,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.create_contribution(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.update_contribution(uuid,uuid,bigint,text,text,jsonb,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.update_accessibility_contribution(uuid,uuid,bigint,text,text,text,jsonb,text,text[],date,text,text,integer,boolean,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.list_accessibility_contributions(uuid,text,text,text,text,text,text,integer) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.get_accessibility_contribution(uuid,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.set_accessibility_lifecycle(uuid,uuid,bigint,text,text,uuid,bytea) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.list_moderation_cases(uuid,text,integer) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.get_route_network(double precision,double precision,double precision,double precision,double precision) TO rutaviva_runtime;
