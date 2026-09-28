CREATE OR REPLACE FUNCTION app_private.set_contribution_reaction(
  p_session_id uuid, p_id uuid, p_reaction text, p_remove boolean, p_request_id uuid
) RETURNS TABLE (confirmations bigint, rejections bigint, my_reaction text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE v_actor_id uuid; owner_id uuid; current_status text; existing_reaction text;
BEGIN
  SELECT candidate.user_id INTO v_actor_id FROM app_private.contribution_actor(p_session_id) candidate;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contribution-reaction:' || v_actor_id::text, 0));
  SELECT contribution.author_id,contribution.status INTO owner_id,current_status FROM app.contributions contribution WHERE contribution.id=p_id FOR UPDATE;
  IF owner_id IS NULL OR current_status <> 'published' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='reaction_unavailable'; END IF;
  IF owner_id=v_actor_id THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='own_contribution_reaction'; END IF;
  SELECT reaction.reaction INTO existing_reaction FROM app.contribution_reactions reaction WHERE reaction.contribution_id=p_id AND reaction.user_id=v_actor_id;
  IF (p_remove AND existing_reaction IS NULL) OR (NOT p_remove AND existing_reaction=p_reaction) THEN
    RETURN QUERY SELECT count(*) FILTER (WHERE reaction.reaction='confirm'),count(*) FILTER (WHERE reaction.reaction='reject'),max(reaction.reaction) FILTER (WHERE reaction.user_id=v_actor_id)
      FROM app.contribution_reactions reaction WHERE reaction.contribution_id=p_id;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM app_private.audit_events event WHERE event.actor_id=v_actor_id AND event.action IN ('contribution.reaction_set','contribution.reaction_removed') AND event.occurred_at>=clock_timestamp()-interval '1 day') >= 30 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='reaction_rate_limited';
  END IF;
  IF p_remove THEN
    DELETE FROM app.contribution_reactions reaction WHERE reaction.contribution_id=p_id AND reaction.user_id=v_actor_id;
  ELSE
    IF p_reaction NOT IN ('confirm','reject') THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_reaction'; END IF;
    INSERT INTO app.contribution_reactions (contribution_id,user_id,reaction) VALUES (p_id,v_actor_id,p_reaction)
    ON CONFLICT (contribution_id,user_id) DO UPDATE SET reaction=excluded.reaction,updated_at=clock_timestamp();
  END IF;
  INSERT INTO app_private.contribution_history (contribution_id,actor_id,action,from_status,to_status,version)
    SELECT contribution.id,v_actor_id,CASE WHEN p_remove THEN 'reaction_removed' ELSE 'reaction_set' END,contribution.status,contribution.status,contribution.version FROM app.contributions contribution WHERE contribution.id=p_id;
  INSERT INTO app_private.audit_events (request_id,actor_id,action,resource_type,resource_id,details)
    VALUES (p_request_id,v_actor_id,CASE WHEN p_remove THEN 'contribution.reaction_removed' ELSE 'contribution.reaction_set' END,'contribution',p_id,'{}'::jsonb);
  RETURN QUERY SELECT count(*) FILTER (WHERE reaction.reaction='confirm'),count(*) FILTER (WHERE reaction.reaction='reject'),max(reaction.reaction) FILTER (WHERE reaction.user_id=v_actor_id)
    FROM app.contribution_reactions reaction WHERE reaction.contribution_id=p_id;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.set_contribution_reaction(uuid,uuid,text,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.set_contribution_reaction(uuid,uuid,text,boolean,uuid) TO rutaviva_runtime;
