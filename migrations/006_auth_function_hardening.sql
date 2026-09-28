CREATE OR REPLACE FUNCTION app_private.verify_magic_link(
  p_verification_id uuid,
  p_token_hash bytea,
  p_ip_hash bytea,
  p_user_id uuid,
  p_identity_id uuid,
  p_session_id uuid,
  p_session_token_hash bytea,
  p_public_alias text,
  p_request_id uuid
) RETURNS TABLE (
  outcome text,
  authenticated boolean,
  user_id uuid,
  public_alias text,
  user_status text,
  user_version bigint,
  session_id uuid,
  session_expires_at timestamptz,
  roles text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  verification app_private.email_verifications%ROWTYPE;
  candidate_email_hash bytea;
  selected_user app.users%ROWTYPE;
  selected_roles text[];
  session_expiry timestamptz;
  created_user boolean := false;
BEGIN
  IF NOT app_private.consume_rate_limit('auth.verify.network', p_ip_hash, 900, 20) THEN
    RETURN QUERY SELECT 'rate_limited', false, NULL::uuid, NULL::text, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz, ARRAY[]::text[];
    RETURN;
  END IF;

  SELECT candidate.normalized_email_hash INTO candidate_email_hash
  FROM app_private.email_verifications AS candidate
  WHERE candidate.id = p_verification_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid', false, NULL::uuid, NULL::text, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz, ARRAY[]::text[];
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.encode(candidate_email_hash, 'hex'), 0)
  );

  SELECT locked_verification.* INTO verification
  FROM app_private.email_verifications AS locked_verification
  WHERE locked_verification.id = p_verification_id
  FOR UPDATE OF locked_verification;

  IF NOT FOUND
     OR verification.normalized_email_hash <> candidate_email_hash
     OR verification.consumed_at IS NOT NULL
     OR verification.revoked_at IS NOT NULL
     OR verification.expires_at <= clock_timestamp()
     OR verification.attempts >= 5 THEN
    RETURN QUERY SELECT 'invalid', false, NULL::uuid, NULL::text, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz, ARRAY[]::text[];
    RETURN;
  END IF;

  IF NOT app_private.constant_time_equal_32(verification.token_hash, p_token_hash) THEN
    UPDATE app_private.email_verifications AS failed_verification
    SET attempts = least(failed_verification.attempts + 1, 5),
        revoked_at = CASE
          WHEN failed_verification.attempts + 1 >= 5 THEN clock_timestamp()
          ELSE failed_verification.revoked_at
        END
    WHERE failed_verification.id = verification.id;
    UPDATE app_private.outbox_events AS outbox
    SET status = 'cancelled'
    WHERE outbox.verification_id = verification.id
      AND outbox.status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM app_private.email_verifications AS exhausted_verification
        WHERE exhausted_verification.id = verification.id
          AND exhausted_verification.revoked_at IS NOT NULL
      );
    RETURN QUERY SELECT 'invalid', false, NULL::uuid, NULL::text, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz, ARRAY[]::text[];
    RETURN;
  END IF;

  UPDATE app_private.email_verifications AS consumed_verification
  SET consumed_at = clock_timestamp()
  WHERE consumed_verification.id = verification.id;
  UPDATE app_private.outbox_events AS outbox
  SET status = 'cancelled'
  WHERE outbox.verification_id = verification.id
    AND outbox.status = 'pending';

  SELECT account.* INTO selected_user
  FROM app_private.identities AS identity
  JOIN app.users AS account ON account.id = identity.user_id
  WHERE identity.normalized_email_hash = verification.normalized_email_hash
  FOR UPDATE OF account;

  IF NOT FOUND THEN
    INSERT INTO app.users (id, public_alias, status)
    VALUES (p_user_id, p_public_alias, 'active')
    RETURNING * INTO selected_user;
    INSERT INTO app_private.identities (
      id, user_id, provider, normalized_email_hash, email_ciphertext, email_nonce, email_tag, verified_at
    ) VALUES (
      p_identity_id, selected_user.id, 'email', verification.normalized_email_hash,
      verification.email_ciphertext, verification.email_nonce, verification.email_tag, clock_timestamp()
    );
    INSERT INTO app.user_roles (user_id, role_code) VALUES (selected_user.id, 'collaborator');
    created_user := true;
  END IF;

  IF selected_user.status <> 'active' THEN
    INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
    VALUES (p_request_id, selected_user.id, 'auth.login_denied', 'user', selected_user.id, jsonb_build_object('account_status', selected_user.status));
    RETURN QUERY SELECT 'account_unavailable', false, NULL::uuid, NULL::text, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz, ARRAY[]::text[];
    RETURN;
  END IF;

  INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
  VALUES (p_request_id, selected_user.id, 'auth.email_verified', 'authentication', verification.id, '{}'::jsonb);
  IF created_user THEN
    INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
    VALUES (p_request_id, selected_user.id, 'auth.role_assigned', 'user', selected_user.id, jsonb_build_object('role', 'collaborator'));
  END IF;

  PERFORM locked_session.id
  FROM app_private.sessions AS locked_session
  WHERE locked_session.user_id = selected_user.id
    AND locked_session.revoked_at IS NULL
  ORDER BY locked_session.id
  FOR UPDATE OF locked_session;

  WITH active AS (
    SELECT active_session.id,
           row_number() OVER (ORDER BY active_session.created_at DESC, active_session.id DESC) AS position
    FROM app_private.sessions AS active_session
    WHERE active_session.user_id = selected_user.id
      AND active_session.revoked_at IS NULL
      AND active_session.expires_at > clock_timestamp()
      AND active_session.idle_expires_at > clock_timestamp()
  ), revoked AS (
    UPDATE app_private.sessions AS revoked_session
    SET revoked_at = clock_timestamp(), revoke_reason = 'session_limit'
    FROM active
    WHERE revoked_session.id = active.id AND active.position >= 5
    RETURNING revoked_session.id
  )
  INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
  SELECT p_request_id, selected_user.id, 'auth.session_revoked', 'session', revoked.id,
         jsonb_build_object('reason', 'session_limit')
  FROM revoked;

  session_expiry := clock_timestamp() + interval '30 days';
  INSERT INTO app_private.sessions (id, user_id, token_hash, idle_expires_at, expires_at)
  VALUES (
    p_session_id, selected_user.id, p_session_token_hash,
    least(session_expiry, clock_timestamp() + interval '7 days'), session_expiry
  );
  SELECT coalesce(
    array_agg(assigned_role.role_code ORDER BY assigned_role.role_code)
      FILTER (WHERE assigned_role.revoked_at IS NULL),
    ARRAY[]::text[]
  ) INTO selected_roles
  FROM app.user_roles AS assigned_role
  WHERE assigned_role.user_id = selected_user.id;
  INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
  VALUES (p_request_id, selected_user.id, 'auth.session_created', 'session', p_session_id, jsonb_build_object('roles', selected_roles));

  RETURN QUERY
  SELECT 'authenticated', true, selected_user.id, selected_user.public_alias, selected_user.status,
         selected_user.version, p_session_id, session_expiry, selected_roles;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.verify_magic_link(uuid, bytea, bytea, uuid, uuid, uuid, bytea, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.verify_magic_link(uuid, bytea, bytea, uuid, uuid, uuid, bytea, text, uuid) TO rutaviva_runtime;
