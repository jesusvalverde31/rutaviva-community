CREATE OR REPLACE FUNCTION app_private.update_contribution(
  p_session_id uuid, p_id uuid, p_expected_version bigint, p_title text,
  p_description text, p_geometry jsonb, p_request_id uuid
) RETURNS TABLE (id uuid, status text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; changed app.contributions%ROWTYPE;
BEGIN
  SELECT candidate.user_id INTO actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  UPDATE app.contributions contribution SET title=trim(p_title),description=trim(coalesce(p_description,'')),
    geometry=extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_geometry::text),4326),
    version=contribution.version+1,updated_at=clock_timestamp()
  WHERE contribution.id=p_id AND contribution.author_id=actor_id AND contribution.status='draft'
    AND contribution.version=p_expected_version RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='contribution_conflict'; END IF;
  INSERT INTO app_private.contribution_history (contribution_id,actor_id,action,from_status,to_status,version)
    VALUES (changed.id,actor_id,'updated',changed.status,changed.status,changed.version);
  INSERT INTO app_private.audit_events (request_id,actor_id,action,resource_type,resource_id,details)
    VALUES (p_request_id,actor_id,'contribution.updated','contribution',changed.id,'{}'::jsonb);
  RETURN QUERY SELECT changed.id,changed.status,changed.version;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.claim_moderation_case(
  p_session_id uuid, p_case_id uuid, p_expected_version bigint, p_request_id uuid
) RETURNS TABLE (id uuid, status text, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE actor_id uuid; actor_roles text[]; contribution_owner uuid; contribution_status text; changed app_private.moderation_cases%ROWTYPE; changed_contribution app.contributions%ROWTYPE;
BEGIN
  SELECT candidate.user_id,candidate.roles INTO actor_id,actor_roles FROM app_private.contribution_actor(p_session_id) candidate;
  IF NOT (coalesce(actor_roles,ARRAY[]::text[]) && ARRAY['moderator','administrator']::text[]) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='moderation_required'; END IF;
  SELECT contribution.author_id,contribution.status INTO contribution_owner,contribution_status
  FROM app_private.moderation_cases moderation JOIN app.contributions contribution ON contribution.id=moderation.contribution_id
  WHERE moderation.id=p_case_id FOR UPDATE OF contribution;
  IF contribution_owner=actor_id THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='own_contribution_moderation'; END IF;
  IF contribution_status<>'submitted' THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='moderation_conflict'; END IF;
  UPDATE app_private.moderation_cases moderation SET status='claimed',claimed_by=actor_id,version=moderation.version+1,updated_at=clock_timestamp()
  WHERE moderation.id=p_case_id AND moderation.status='pending' AND moderation.version=p_expected_version RETURNING * INTO changed;
  IF changed.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='moderation_conflict'; END IF;
  UPDATE app.contributions contribution SET status='under_review',version=contribution.version+1,updated_at=clock_timestamp()
  WHERE contribution.id=changed.contribution_id AND contribution.status='submitted' RETURNING * INTO changed_contribution;
  IF changed_contribution.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='moderation_conflict'; END IF;
  INSERT INTO app_private.contribution_history (contribution_id,actor_id,action,from_status,to_status,version)
    VALUES (changed_contribution.id,actor_id,'claimed','submitted',changed_contribution.status,changed_contribution.version);
  INSERT INTO app_private.audit_events (request_id,actor_id,action,resource_type,resource_id,details)
    VALUES (p_request_id,actor_id,'moderation.claimed','moderation_case',changed.id,'{}'::jsonb);
  RETURN QUERY SELECT changed.id,changed.status,changed.version;
END;
$function$;
