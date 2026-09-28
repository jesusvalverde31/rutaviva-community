CREATE TABLE app_private.moderation_cases (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL UNIQUE REFERENCES app.contributions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'resolved')),
  claimed_by uuid REFERENCES app.users(id) ON DELETE RESTRICT,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK ((status = 'claimed' AND claimed_by IS NOT NULL) OR status <> 'claimed')
);

CREATE TABLE app_private.moderation_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES app_private.moderation_cases(id) ON DELETE RESTRICT,
  moderator_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('published', 'rejected')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX moderation_cases_queue_idx ON app_private.moderation_cases (status, created_at, id);
CREATE INDEX moderation_decisions_case_idx ON app_private.moderation_decisions (case_id, created_at DESC);

CREATE OR REPLACE FUNCTION app_private.open_moderation_case()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO app_private.moderation_cases (id, contribution_id)
    VALUES (NEW.id, NEW.id) ON CONFLICT (contribution_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER contributions_open_moderation_case
AFTER UPDATE OF status ON app.contributions
FOR EACH ROW EXECUTE FUNCTION app_private.open_moderation_case();

CREATE OR REPLACE FUNCTION app_private.reject_moderation_decision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation decisions are append-only'; END;
$function$;

CREATE TRIGGER moderation_decisions_append_only
BEFORE UPDATE OR DELETE ON app_private.moderation_decisions
FOR EACH ROW EXECUTE FUNCTION app_private.reject_moderation_decision_mutation();

CREATE OR REPLACE FUNCTION app_private.list_moderation_cases(p_session_id uuid, p_status text, p_limit integer)
RETURNS TABLE (
  id uuid, contribution_id uuid, case_status text, case_version bigint, title text, kind text,
  contribution_status text, geometry text, author_alias text, author_id uuid,
  confirmations bigint, rejections bigint, created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE actor_roles text[];
BEGIN
  SELECT candidate.roles INTO actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT (coalesce(actor_roles, ARRAY[]::text[]) && ARRAY['moderator','administrator']::text[]) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'moderation_required';
  END IF;
  RETURN QUERY
  SELECT moderation.id, moderation.contribution_id, moderation.status, moderation.version,
    contribution.title, contribution.kind, contribution.status,
    extensions.ST_AsGeoJSON(contribution.geometry, 6), account.public_alias, contribution.author_id,
    count(reaction.*) FILTER (WHERE reaction.reaction='confirm'),
    count(reaction.*) FILTER (WHERE reaction.reaction='reject'), moderation.created_at, moderation.updated_at
  FROM app_private.moderation_cases moderation
  JOIN app.contributions contribution ON contribution.id=moderation.contribution_id
  JOIN app.users account ON account.id=contribution.author_id
  LEFT JOIN app.contribution_reactions reaction ON reaction.contribution_id=contribution.id
  WHERE (p_status IS NULL OR moderation.status=p_status)
  GROUP BY moderation.id, contribution.id, account.public_alias
  ORDER BY moderation.created_at, moderation.id
  LIMIT greatest(1, least(coalesce(p_limit,50),100));
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.claim_moderation_case(
  p_session_id uuid, p_case_id uuid, p_expected_version bigint, p_request_id uuid
) RETURNS TABLE (id uuid, status text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; actor_roles text[]; contribution_owner uuid; changed app_private.moderation_cases%ROWTYPE;
BEGIN
  SELECT candidate.user_id, candidate.roles INTO actor_id, actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT (coalesce(actor_roles,ARRAY[]::text[]) && ARRAY['moderator','administrator']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='moderation_required'; END IF;
  SELECT contribution.author_id INTO contribution_owner FROM app_private.moderation_cases moderation JOIN app.contributions contribution ON contribution.id=moderation.contribution_id WHERE moderation.id=p_case_id;
  IF contribution_owner=actor_id THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='own_contribution_moderation'; END IF;
  UPDATE app_private.moderation_cases moderation SET status='claimed', claimed_by=actor_id, version=moderation.version+1, updated_at=clock_timestamp()
  WHERE moderation.id=p_case_id AND moderation.status='pending' AND moderation.version=p_expected_version RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='moderation_conflict'; END IF;
  UPDATE app.contributions contribution SET status='under_review', version=contribution.version+1, updated_at=clock_timestamp() WHERE contribution.id=changed.contribution_id AND contribution.status='submitted';
  INSERT INTO app_private.contribution_history (contribution_id,actor_id,action,from_status,to_status,version)
  SELECT contribution.id,actor_id,'claimed','submitted',contribution.status,contribution.version FROM app.contributions contribution WHERE contribution.id=changed.contribution_id;
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
  INSERT INTO app_private.moderation_decisions (case_id,moderator_id,decision,reason) VALUES (changed.id,actor_id,p_decision,trim(p_reason));
  INSERT INTO app_private.contribution_history (contribution_id,actor_id,action,from_status,to_status,version) VALUES (changed_contribution.id,actor_id,p_decision,'under_review',p_decision,changed_contribution.version);
  INSERT INTO app_private.audit_events (request_id,actor_id,action,resource_type,resource_id,details) VALUES (p_request_id,actor_id,'moderation.'||p_decision,'moderation_case',changed.id,jsonb_build_object('decision',p_decision));
  RETURN QUERY SELECT changed.id,changed.status,changed.version,changed_contribution.status;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.community_activity()
RETURNS TABLE (day date, received bigint, published bigint, pending bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
  WITH days AS (SELECT generate_series(current_date-6,current_date,interval '1 day')::date AS day)
  SELECT days.day,
    count(contribution.*) FILTER (WHERE contribution.created_at::date=days.day),
    count(contribution.*) FILTER (WHERE contribution.published_at::date=days.day),
    count(contribution.*) FILTER (WHERE contribution.created_at::date<=days.day AND contribution.status IN ('submitted','under_review'))
  FROM days LEFT JOIN app.contributions contribution ON contribution.created_at::date<=days.day
  GROUP BY days.day ORDER BY days.day;
$function$;

REVOKE ALL ON app_private.moderation_cases, app_private.moderation_decisions FROM PUBLIC, rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.list_moderation_cases(uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.claim_moderation_case(uuid,uuid,bigint,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.decide_moderation_case(uuid,uuid,bigint,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.community_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.list_moderation_cases(uuid,text,integer) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.claim_moderation_case(uuid,uuid,bigint,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.decide_moderation_case(uuid,uuid,bigint,text,text,uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.community_activity() TO rutaviva_runtime;
