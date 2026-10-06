-- Bloque 39: edición completa de borradores y reportes con decisión humana.
CREATE TABLE app_private.content_reports (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL REFERENCES app.contributions(id) ON DELETE RESTRICT,
  reporter_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(reason IN ('personal_data','abusive','dangerous','spam','other')),
  detail text NOT NULL DEFAULT '' CHECK(char_length(detail)<=500),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
  reviewer_id uuid REFERENCES app.users(id) ON DELETE RESTRICT,
  decision_reason text CHECK(decision_reason IS NULL OR char_length(decision_reason) BETWEEN 3 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  CHECK((status='pending' AND reviewer_id IS NULL AND decision_reason IS NULL AND decided_at IS NULL) OR (status IN ('resolved','dismissed') AND reviewer_id IS NOT NULL AND decision_reason IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX content_reports_one_pending_idx ON app_private.content_reports(reporter_id,contribution_id) WHERE status='pending';
CREATE INDEX content_reports_queue_idx ON app_private.content_reports(status,created_at,id);
COMMENT ON TABLE app_private.content_reports IS 'Reportes para revisión humana. Retención propuesta: 24 meses desde la decisión; la eliminación requiere una operación futura auditada.';

CREATE TABLE app_private.content_report_decision_requests (
  request_id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  report_id uuid NOT NULL REFERENCES app_private.content_reports(id) ON DELETE RESTRICT,
  expected_version bigint NOT NULL CHECK(expected_version>0), decision text NOT NULL CHECK(decision IN ('resolve','dismiss')),
  request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32), result_status text NOT NULL CHECK(result_status IN ('resolved','dismissed')),
  result_version bigint NOT NULL CHECK(result_version>0), contribution_status text NOT NULL, contribution_version bigint NOT NULL CHECK(contribution_version>0), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION app_private.create_content_report(p_session_id uuid,p_id uuid,p_contribution_id uuid,p_reason text,p_detail text,p_request_hash bytea,p_audit_request_id uuid)
RETURNS TABLE(id uuid,status text,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;existing app_private.content_reports%ROWTYPE;created app_private.content_reports%ROWTYPE;target_status text;
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication_required'; END IF;
  IF p_id IS NULL OR p_reason NOT IN ('personal_data','abusive','dangerous','spam','other') OR char_length(trim(coalesce(p_detail,'')))>500 OR p_request_hash IS NULL OR octet_length(p_request_hash)<>32 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_report'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('content-report:'||p_id::text,0));
  SELECT report.* INTO existing FROM app_private.content_reports report WHERE report.id=p_id;
  IF FOUND THEN
    IF existing.reporter_id<>actor_id OR existing.contribution_id<>p_contribution_id OR existing.request_hash<>p_request_hash THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict'; END IF;
    RETURN QUERY SELECT existing.id,existing.status,existing.version;RETURN;
  END IF;
  SELECT contribution.status INTO target_status FROM app.contributions contribution WHERE contribution.id=p_contribution_id;
  IF target_status IS DISTINCT FROM 'published' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='report_target_invalid'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('content-report-rate:'||actor_id::text,0));
  IF (SELECT count(*) FROM app_private.content_reports report WHERE report.reporter_id=actor_id AND report.created_at>=clock_timestamp()-interval '1 day')>=10 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='report_rate_limited'; END IF;
  BEGIN
    INSERT INTO app_private.content_reports(id,contribution_id,reporter_id,reason,detail,request_hash) VALUES(p_id,p_contribution_id,actor_id,p_reason,trim(coalesce(p_detail,'')),p_request_hash) RETURNING * INTO created;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='pending_report_exists'; END;
  INSERT INTO app_private.audit_events(request_id,actor_id,action,resource_type,resource_id,details) VALUES(p_audit_request_id,actor_id,'content_report.created','content_report',created.id,jsonb_build_object('reason',created.reason,'contributionId',created.contribution_id));
  RETURN QUERY SELECT created.id,created.status,created.version;
END;$function$;

CREATE FUNCTION app_private.list_content_reports(p_session_id uuid,p_status text,p_limit integer)
RETURNS TABLE(id uuid,contribution_id uuid,reason text,detail text,status text,version bigint,contribution_version bigint,title text,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;actor_roles text[];
BEGIN
  SELECT candidate.user_id,candidate.roles INTO actor_id,actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT(coalesce(actor_roles,ARRAY[]::text[])&&ARRAY['moderator','administrator']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='moderation_required'; END IF;
  IF p_status NOT IN ('pending','resolved','dismissed') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_report_status'; END IF;
  RETURN QUERY SELECT report.id,report.contribution_id,report.reason,report.detail,report.status,report.version,contribution.version,contribution.title,report.created_at
    FROM app_private.content_reports report JOIN app.contributions contribution ON contribution.id=report.contribution_id
    WHERE report.status=p_status AND report.reporter_id<>actor_id AND contribution.author_id<>actor_id
    ORDER BY report.created_at,report.id LIMIT greatest(1,least(coalesce(p_limit,50),100));
END;$function$;

CREATE FUNCTION app_private.decide_content_report(p_session_id uuid,p_id uuid,p_expected_version bigint,p_decision text,p_reason text,p_request_id uuid,p_request_hash bytea,p_audit_request_id uuid)
RETURNS TABLE(id uuid,status text,version bigint,contribution_status text,contribution_version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;actor_roles text[];report_row app_private.content_reports%ROWTYPE;contribution_row app.contributions%ROWTYPE;changed app_private.content_reports%ROWTYPE;previous app_private.content_report_decision_requests%ROWTYPE;
BEGIN
  SELECT candidate.user_id,candidate.roles INTO actor_id,actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT(coalesce(actor_roles,ARRAY[]::text[])&&ARRAY['moderator','administrator']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='moderation_required'; END IF;
  IF p_expected_version<1 OR p_decision NOT IN ('resolve','dismiss') OR char_length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 300 OR p_request_id IS NULL OR p_request_hash IS NULL OR octet_length(p_request_hash)<>32 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_report_decision'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('content-report-decision:'||p_request_id::text,0));
  SELECT request.* INTO previous FROM app_private.content_report_decision_requests request WHERE request.request_id=p_request_id;
  IF FOUND THEN
    IF previous.actor_id<>actor_id OR previous.report_id<>p_id OR previous.expected_version<>p_expected_version OR previous.decision<>p_decision OR previous.request_hash<>p_request_hash THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='idempotency_conflict'; END IF;
    RETURN QUERY SELECT previous.report_id,previous.result_status,previous.result_version,previous.contribution_status,previous.contribution_version;RETURN;
  END IF;
  SELECT report.* INTO report_row FROM app_private.content_reports report WHERE report.id=p_id FOR UPDATE;
  IF report_row.id IS NULL OR report_row.status<>'pending' OR report_row.version<>p_expected_version THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='report_conflict'; END IF;
  SELECT contribution.* INTO contribution_row FROM app.contributions contribution WHERE contribution.id=report_row.contribution_id FOR UPDATE;
  IF actor_id=report_row.reporter_id OR actor_id=contribution_row.author_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='report_review_conflict'; END IF;
  IF p_decision='resolve' THEN
    IF contribution_row.status<>'published' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='report_conflict'; END IF;
    UPDATE app.contributions contribution SET status='withdrawn',version=contribution.version+1,updated_at=clock_timestamp() WHERE contribution.id=contribution_row.id RETURNING * INTO contribution_row;
    INSERT INTO app_private.contribution_history(contribution_id,actor_id,action,from_status,to_status,version) VALUES(contribution_row.id,actor_id,'withdrawn','published','withdrawn',contribution_row.version);
  END IF;
  UPDATE app_private.content_reports report SET status=CASE WHEN p_decision='resolve' THEN 'resolved' ELSE 'dismissed' END,reviewer_id=actor_id,decision_reason=trim(p_reason),decided_at=clock_timestamp(),updated_at=clock_timestamp(),version=report.version+1 WHERE report.id=p_id RETURNING * INTO changed;
  INSERT INTO app_private.audit_events(request_id,actor_id,action,resource_type,resource_id,details) VALUES(p_audit_request_id,actor_id,'content_report.'||changed.status,'content_report',changed.id,jsonb_build_object('contributionId',changed.contribution_id,'decision',p_decision));
  INSERT INTO app_private.content_report_decision_requests(request_id,actor_id,report_id,expected_version,decision,request_hash,result_status,result_version,contribution_status,contribution_version) VALUES(p_request_id,actor_id,p_id,p_expected_version,p_decision,p_request_hash,changed.status,changed.version,contribution_row.status,contribution_row.version);
  RETURN QUERY SELECT changed.id,changed.status,changed.version,contribution_row.status,contribution_row.version;
END;$function$;

DROP FUNCTION app_private.update_accessibility_contribution(uuid,uuid,bigint,text,text,text,jsonb,text,text[],date,text,text,integer,boolean,uuid);
CREATE FUNCTION app_private.update_accessibility_contribution(p_session_id uuid,p_id uuid,p_expected_version bigint,p_zone_id uuid,p_kind text,p_title text,p_description text,p_geometry jsonb,p_condition_type text,p_affected_groups text[],p_observed_on date,p_permanence text,p_measurement_status text,p_clear_width_cm integer,p_personal_data_confirmed boolean,p_request_id uuid)
RETURNS TABLE(id uuid,status text,version bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE actor_id uuid;changed app.contributions%ROWTYPE;requested_geometry extensions.geometry(Geometry,4326);target_city uuid;zone_city uuid;
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication_required'; END IF;
  PERFORM app_private.validate_accessibility_details(p_kind,p_geometry,p_condition_type,p_affected_groups,p_observed_on,p_permanence,p_measurement_status,p_clear_width_cm,'open',p_personal_data_confirmed);
  SELECT contribution.city_id INTO target_city FROM app.contributions contribution WHERE contribution.id=p_id AND contribution.author_id=actor_id;
  IF p_zone_id IS NOT NULL THEN SELECT zone.city_id INTO zone_city FROM app.zones zone WHERE zone.id=p_zone_id AND zone.is_active; END IF;
  IF p_zone_id IS NOT NULL AND zone_city IS DISTINCT FROM target_city THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_zone'; END IF;
  requested_geometry:=extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text),4326);
  UPDATE app.contributions contribution SET zone_id=p_zone_id,kind=p_kind,title=trim(p_title),description=trim(coalesce(p_description,'')),geometry=requested_geometry,condition_type=p_condition_type,affected_groups=p_affected_groups,observed_on=p_observed_on,permanence=p_permanence,measurement_status=p_measurement_status,clear_width_cm=p_clear_width_cm,personal_data_confirmed=p_personal_data_confirmed,version=contribution.version+1,updated_at=clock_timestamp()
    WHERE contribution.id=p_id AND contribution.author_id=actor_id AND contribution.status='draft' AND contribution.lifecycle_status='open' AND contribution.version=p_expected_version RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='contribution_conflict'; END IF;
  INSERT INTO app_private.contribution_history(contribution_id,actor_id,action,from_status,to_status,version) VALUES(changed.id,actor_id,'updated',changed.status,changed.status,changed.version);
  INSERT INTO app_private.audit_events(request_id,actor_id,action,resource_type,resource_id,details) VALUES(p_request_id,actor_id,'contribution.updated','contribution',changed.id,jsonb_build_object('kind',changed.kind,'conditionType',changed.condition_type,'zoneId',changed.zone_id));
  RETURN QUERY SELECT changed.id,changed.status,changed.version;
END;$function$;

REVOKE ALL ON app_private.content_reports,app_private.content_report_decision_requests FROM PUBLIC,rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.create_content_report(uuid,uuid,uuid,text,text,bytea,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.list_content_reports(uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.decide_content_report(uuid,uuid,bigint,text,text,uuid,bytea,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.update_accessibility_contribution(uuid,uuid,bigint,uuid,text,text,text,jsonb,text,text[],date,text,text,integer,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.create_content_report(uuid,uuid,uuid,text,text,bytea,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.list_content_reports(uuid,text,integer) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.decide_content_report(uuid,uuid,bigint,text,text,uuid,bytea,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.update_accessibility_contribution(uuid,uuid,bigint,uuid,text,text,text,jsonb,text,text[],date,text,text,integer,boolean,uuid) TO rutaviva_runtime;
