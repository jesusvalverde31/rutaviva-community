CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  public_alias text NOT NULL UNIQUE CHECK (char_length(public_alias) BETWEEN 3 AND 60),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deletion_requested', 'anonymized')),
  locale text NOT NULL DEFAULT 'es' CHECK (locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE app_private.identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider = 'email'),
  normalized_email_hash bytea NOT NULL UNIQUE CHECK (octet_length(normalized_email_hash) = 32),
  email_ciphertext bytea NOT NULL,
  email_nonce bytea NOT NULL CHECK (octet_length(email_nonce) = 12),
  email_tag bytea NOT NULL CHECK (octet_length(email_tag) = 16),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE app.roles (
  code text PRIMARY KEY CHECK (code IN ('collaborator', 'moderator', 'administrator', 'system')),
  name text NOT NULL UNIQUE
);

CREATE TABLE app.permissions (
  code text PRIMARY KEY CHECK (code ~ '^[a-z]+(?:\.[a-z]+)*$'),
  description text NOT NULL
);

CREATE TABLE app.role_permissions (
  role_code text NOT NULL REFERENCES app.roles(code) ON DELETE RESTRICT,
  permission_code text NOT NULL REFERENCES app.permissions(code) ON DELETE RESTRICT,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE app.user_roles (
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  role_code text NOT NULL REFERENCES app.roles(code) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES app.users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  PRIMARY KEY (user_id, role_code),
  CHECK (role_code <> 'system'),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE TABLE app_private.email_verifications (
  id uuid PRIMARY KEY,
  normalized_email_hash bytea NOT NULL CHECK (octet_length(normalized_email_hash) = 32),
  email_ciphertext bytea NOT NULL,
  email_nonce bytea NOT NULL CHECK (octet_length(email_nonce) = 12),
  email_tag bytea NOT NULL CHECK (octet_length(email_tag) = 16),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE app_private.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 1 AND 80),
  CHECK (idle_expires_at <= expires_at),
  CHECK (expires_at > created_at)
);

CREATE TABLE app_private.outbox_events (
  id uuid PRIMARY KEY,
  verification_id uuid NOT NULL UNIQUE REFERENCES app_private.email_verifications(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type = 'auth.magic_link'),
  payload_ciphertext bytea NOT NULL,
  payload_nonce bytea NOT NULL CHECK (octet_length(payload_nonce) = 12),
  payload_tag bytea NOT NULL CHECK (octet_length(payload_tag) = 16),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE app_private.api_idempotency (
  scope_hash bytea NOT NULL CHECK (octet_length(scope_hash) = 32),
  method text NOT NULL,
  endpoint text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  response_body jsonb NOT NULL CHECK (jsonb_typeof(response_body) = 'object'),
  response_status smallint NOT NULL CHECK (response_status BETWEEN 200 AND 599),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope_hash, method, endpoint, idempotency_key)
);

CREATE TABLE app_private.rate_limit_buckets (
  operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 80),
  identity_hash bytea NOT NULL CHECK (octet_length(identity_hash) = 32),
  window_started_at timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (operation, identity_hash, window_started_at)
);

CREATE INDEX identities_user_idx ON app_private.identities (user_id);
CREATE INDEX email_verifications_token_idx ON app_private.email_verifications (token_hash) WHERE consumed_at IS NULL;
CREATE INDEX email_verifications_cleanup_idx ON app_private.email_verifications (expires_at);
CREATE INDEX sessions_user_active_idx ON app_private.sessions (user_id, created_at) WHERE revoked_at IS NULL;
CREATE INDEX sessions_cleanup_idx ON app_private.sessions (expires_at);
CREATE INDEX outbox_pending_idx ON app_private.outbox_events (available_at, created_at) WHERE status = 'pending';
CREATE INDEX idempotency_cleanup_idx ON app_private.api_idempotency (expires_at);
CREATE INDEX rate_limit_cleanup_idx ON app_private.rate_limit_buckets (expires_at);

INSERT INTO app.roles (code, name) VALUES
  ('collaborator', 'Colaborador'),
  ('moderator', 'Moderador'),
  ('administrator', 'Administrador'),
  ('system', 'Sistema')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.permissions (code, description) VALUES
  ('account.read', 'Consultar la cuenta propia'),
  ('session.manage', 'Gestionar las sesiones propias'),
  ('contribution.create', 'Crear aportaciones'),
  ('moderation.review', 'Revisar contenido comunitario'),
  ('administration.manage', 'Administrar el servicio')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.role_permissions (role_code, permission_code) VALUES
  ('collaborator', 'account.read'),
  ('collaborator', 'session.manage'),
  ('collaborator', 'contribution.create'),
  ('moderator', 'account.read'),
  ('moderator', 'session.manage'),
  ('moderator', 'contribution.create'),
  ('moderator', 'moderation.review'),
  ('administrator', 'account.read'),
  ('administrator', 'session.manage'),
  ('administrator', 'contribution.create'),
  ('administrator', 'moderation.review'),
  ('administrator', 'administration.manage')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.consume_rate_limit(
  p_operation text,
  p_identity_hash bytea,
  p_window_seconds integer,
  p_max_hits integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  bucket_start timestamptz;
  current_hits integer;
BEGIN
  IF p_window_seconds < 1 OR p_max_hits < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid rate limit configuration';
  END IF;
  bucket_start := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds);
  INSERT INTO app_private.rate_limit_buckets (operation, identity_hash, window_started_at, hits, expires_at)
  VALUES (p_operation, p_identity_hash, bucket_start, 1, bucket_start + make_interval(secs => p_window_seconds * 2))
  ON CONFLICT (operation, identity_hash, window_started_at)
  DO UPDATE SET hits = app_private.rate_limit_buckets.hits + 1
  RETURNING hits INTO current_hits;
  RETURN current_hits <= p_max_hits;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.request_magic_link(
  p_verification_id uuid,
  p_outbox_id uuid,
  p_email_hash bytea,
  p_ip_hash bytea,
  p_global_hash bytea,
  p_email_ciphertext bytea,
  p_email_nonce bytea,
  p_email_tag bytea,
  p_token_hash bytea,
  p_outbox_ciphertext bytea,
  p_outbox_nonce bytea,
  p_outbox_tag bytea,
  p_idempotency_key text,
  p_request_hash bytea,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  previous app_private.api_idempotency%ROWTYPE;
  response jsonb := jsonb_build_object('accepted', true);
  email_allowed boolean;
  ip_allowed boolean;
  global_allowed boolean := false;
  queued boolean := false;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.encode(p_global_hash, 'hex') || ':' || p_idempotency_key,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.encode(p_email_hash, 'hex'), 0)
  );
  DELETE FROM app_private.api_idempotency
  WHERE scope_hash = p_global_hash
    AND method = 'POST'
    AND endpoint = '/api/v1/auth/request-link'
    AND idempotency_key = p_idempotency_key
    AND expires_at <= clock_timestamp();

  SELECT * INTO previous
  FROM app_private.api_idempotency
  WHERE scope_hash = p_global_hash
    AND method = 'POST'
    AND endpoint = '/api/v1/auth/request-link'
    AND idempotency_key = p_idempotency_key
    AND expires_at > clock_timestamp()
  FOR UPDATE;

  IF FOUND THEN
    IF previous.request_hash <> p_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'idempotency_conflict';
    END IF;
    RETURN previous.response_body;
  END IF;

  email_allowed := app_private.consume_rate_limit('auth.request_link.email', p_email_hash, 900, 3);
  ip_allowed := app_private.consume_rate_limit('auth.request_link.network', p_ip_hash, 3600, 10);
  IF email_allowed AND ip_allowed THEN
    global_allowed := app_private.consume_rate_limit('auth.request_link.global', p_global_hash, 86400, 250);
  END IF;

  IF NOT ip_allowed THEN
    response := jsonb_build_object('accepted', false, 'outcome', 'rate_limited', 'retry_after', 3600);
  ELSIF email_allowed AND ip_allowed AND NOT global_allowed THEN
    response := jsonb_build_object('accepted', false, 'outcome', 'capacity_exhausted', 'retry_after', 86400);
  ELSIF email_allowed AND ip_allowed AND global_allowed THEN
    WITH revoked AS (
      UPDATE app_private.email_verifications verification
      SET revoked_at = clock_timestamp()
      WHERE verification.normalized_email_hash = p_email_hash
        AND verification.consumed_at IS NULL
        AND verification.revoked_at IS NULL
        AND verification.expires_at > clock_timestamp()
      RETURNING verification.id
    )
    UPDATE app_private.outbox_events outbox
    SET status = 'cancelled'
    FROM revoked
    WHERE outbox.verification_id = revoked.id
      AND outbox.status = 'pending';
    INSERT INTO app_private.email_verifications (
      id, normalized_email_hash, email_ciphertext, email_nonce, email_tag, token_hash, expires_at
    ) VALUES (
      p_verification_id, p_email_hash, p_email_ciphertext, p_email_nonce, p_email_tag, p_token_hash,
      clock_timestamp() + interval '15 minutes'
    );
    INSERT INTO app_private.outbox_events (
      id, verification_id, event_type, payload_ciphertext, payload_nonce, payload_tag
    ) VALUES (
      p_outbox_id, p_verification_id, 'auth.magic_link', p_outbox_ciphertext, p_outbox_nonce, p_outbox_tag
    );
    queued := true;
  END IF;

  INSERT INTO app_private.api_idempotency (
    scope_hash, method, endpoint, idempotency_key, request_hash, response_body, response_status, expires_at
  ) VALUES (
    p_global_hash, 'POST', '/api/v1/auth/request-link', p_idempotency_key, p_request_hash, response,
    CASE
      WHEN response->>'outcome' = 'rate_limited' THEN 429
      WHEN response->>'outcome' = 'capacity_exhausted' THEN 503
      ELSE 202
    END,
    clock_timestamp() + interval '24 hours'
  );
  INSERT INTO app_private.audit_events (request_id, action, resource_type, resource_id, details)
  VALUES (p_request_id, 'auth.link_requested', 'authentication', NULL, jsonb_build_object('queued', queued));
  RETURN response;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.constant_time_equal_32(
  p_left bytea,
  p_right bytea
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
DECLARE
  difference integer := 0;
  position integer;
BEGIN
  IF p_left IS NULL OR p_right IS NULL
     OR octet_length(p_left) <> 32 OR octet_length(p_right) <> 32 THEN
    RETURN false;
  END IF;
  FOR position IN 0..31 LOOP
    difference := difference | (get_byte(p_left, position) # get_byte(p_right, position));
  END LOOP;
  RETURN difference = 0;
END;
$function$;

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
  FROM app_private.email_verifications candidate
  WHERE candidate.id = p_verification_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid', false, NULL::uuid, NULL::text, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz, ARRAY[]::text[];
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.encode(candidate_email_hash, 'hex'), 0)
  );

  SELECT * INTO verification
  FROM app_private.email_verifications
  WHERE id = p_verification_id
  FOR UPDATE;

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
    UPDATE app_private.email_verifications
    SET attempts = least(attempts + 1, 5),
        revoked_at = CASE WHEN attempts + 1 >= 5 THEN clock_timestamp() ELSE revoked_at END
    WHERE id = verification.id;
    UPDATE app_private.outbox_events outbox
    SET status = 'cancelled'
    WHERE outbox.verification_id = verification.id
      AND outbox.status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM app_private.email_verifications failed
        WHERE failed.id = verification.id
          AND failed.revoked_at IS NOT NULL
      );
    RETURN QUERY SELECT 'invalid', false, NULL::uuid, NULL::text, NULL::text, NULL::bigint, NULL::uuid, NULL::timestamptz, ARRAY[]::text[];
    RETURN;
  END IF;

  UPDATE app_private.email_verifications
  SET consumed_at = clock_timestamp()
  WHERE id = verification.id;
  UPDATE app_private.outbox_events outbox
  SET status = 'cancelled'
  WHERE outbox.verification_id = verification.id
    AND outbox.status = 'pending';

  SELECT account.* INTO selected_user
  FROM app_private.identities identity
  JOIN app.users account ON account.id = identity.user_id
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

  PERFORM id
  FROM app_private.sessions
  WHERE user_id = selected_user.id AND revoked_at IS NULL
  ORDER BY id
  FOR UPDATE;

  WITH active AS (
    SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) AS position
    FROM app_private.sessions
    WHERE user_id = selected_user.id
      AND revoked_at IS NULL
      AND expires_at > clock_timestamp()
      AND idle_expires_at > clock_timestamp()
  ), revoked AS (
    UPDATE app_private.sessions session
    SET revoked_at = clock_timestamp(), revoke_reason = 'session_limit'
    FROM active
    WHERE session.id = active.id AND active.position >= 5
    RETURNING session.id
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
  SELECT coalesce(array_agg(role.role_code ORDER BY role.role_code) FILTER (WHERE role.revoked_at IS NULL), ARRAY[]::text[])
  INTO selected_roles
  FROM app.user_roles role
  WHERE role.user_id = selected_user.id;
  INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
  VALUES (p_request_id, selected_user.id, 'auth.session_created', 'session', p_session_id, jsonb_build_object('roles', selected_roles));

  RETURN QUERY
  SELECT 'authenticated', true, selected_user.id, selected_user.public_alias, selected_user.status,
         selected_user.version, p_session_id, session_expiry, selected_roles;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.authenticate_session(
  p_token_hash bytea
) RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  public_alias text,
  user_status text,
  user_version bigint,
  session_expires_at timestamptz,
  roles text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  selected_session app_private.sessions%ROWTYPE;
  selected_user app.users%ROWTYPE;
  selected_roles text[];
BEGIN
  SELECT account.* INTO selected_user
  FROM app.users account
  JOIN app_private.sessions session ON session.user_id = account.id
  WHERE session.token_hash = p_token_hash
    AND session.revoked_at IS NULL
    AND session.expires_at > clock_timestamp()
    AND session.idle_expires_at > clock_timestamp()
    AND account.status = 'active'
  FOR SHARE OF account;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT session.* INTO selected_session
  FROM app_private.sessions session
  WHERE session.token_hash = p_token_hash
    AND session.user_id = selected_user.id
    AND session.revoked_at IS NULL
    AND session.expires_at > clock_timestamp()
    AND session.idle_expires_at > clock_timestamp()
  FOR UPDATE OF session;
  IF NOT FOUND THEN RETURN; END IF;

  IF selected_session.last_seen_at <= clock_timestamp() - interval '5 minutes' THEN
    UPDATE app_private.sessions session
    SET last_seen_at = clock_timestamp(),
        idle_expires_at = least(session.expires_at, clock_timestamp() + interval '7 days')
    WHERE session.id = selected_session.id;
  END IF;
  SELECT coalesce(array_agg(role.role_code ORDER BY role.role_code) FILTER (WHERE role.revoked_at IS NULL), ARRAY[]::text[])
  INTO selected_roles
  FROM app.user_roles role
  WHERE role.user_id = selected_user.id;
  RETURN QUERY SELECT selected_session.id, selected_user.id, selected_user.public_alias,
    selected_user.status, selected_user.version, selected_session.expires_at, selected_roles;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.list_sessions(p_actor_session_id uuid)
RETURNS TABLE (id uuid, created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz, current_session boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT session.id, session.created_at, session.last_seen_at,
         least(session.expires_at, session.idle_expires_at), session.id = p_actor_session_id
  FROM app_private.sessions actor
  JOIN app.users account ON account.id = actor.user_id
  JOIN app_private.sessions session ON session.user_id = actor.user_id
  WHERE actor.id = p_actor_session_id
    AND actor.revoked_at IS NULL
    AND actor.expires_at > clock_timestamp()
    AND actor.idle_expires_at > clock_timestamp()
    AND account.status = 'active'
    AND session.revoked_at IS NULL
    AND session.expires_at > clock_timestamp()
    AND session.idle_expires_at > clock_timestamp()
  ORDER BY session.created_at DESC, session.id DESC;
$function$;

CREATE OR REPLACE FUNCTION app_private.revoke_session(
  p_actor_session_id uuid,
  p_target_session_id uuid,
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  changed uuid;
BEGIN
  UPDATE app_private.sessions target
  SET revoked_at = clock_timestamp(), revoke_reason = 'user_revoked'
  FROM app_private.sessions actor
  JOIN app.users account ON account.id = actor.user_id
  WHERE actor.id = p_actor_session_id
    AND actor.revoked_at IS NULL
    AND actor.expires_at > clock_timestamp()
    AND actor.idle_expires_at > clock_timestamp()
    AND account.status = 'active'
    AND actor.user_id = target.user_id
    AND target.id = p_target_session_id
    AND target.revoked_at IS NULL
  RETURNING target.id INTO changed;
  IF changed IS NOT NULL THEN
    INSERT INTO app_private.audit_events (request_id, actor_id, action, resource_type, resource_id, details)
    SELECT p_request_id, actor.user_id, 'auth.session_revoked', 'session', changed, jsonb_build_object('reason', 'user_revoked')
    FROM app_private.sessions actor WHERE actor.id = p_actor_session_id;
  END IF;
  RETURN changed IS NOT NULL;
END;
$function$;

REVOKE ALL ON app.users, app.roles, app.permissions, app.role_permissions, app.user_roles FROM PUBLIC;
REVOKE ALL ON app_private.identities, app_private.email_verifications, app_private.sessions,
  app_private.outbox_events, app_private.api_idempotency, app_private.rate_limit_buckets FROM PUBLIC;
REVOKE ALL ON app.users, app.roles, app.permissions, app.role_permissions, app.user_roles FROM rutaviva_runtime;
REVOKE ALL ON app_private.identities, app_private.email_verifications, app_private.sessions,
  app_private.outbox_events, app_private.api_idempotency, app_private.rate_limit_buckets FROM rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.consume_rate_limit(text, bytea, integer, integer) FROM PUBLIC, rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.constant_time_equal_32(bytea, bytea) FROM PUBLIC, rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.request_magic_link(uuid, uuid, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, text, bytea, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.verify_magic_link(uuid, bytea, bytea, uuid, uuid, uuid, bytea, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.authenticate_session(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.list_sessions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.revoke_session(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.request_magic_link(uuid, uuid, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, text, bytea, uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.verify_magic_link(uuid, bytea, bytea, uuid, uuid, uuid, bytea, text, uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.authenticate_session(bytea) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.list_sessions(uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.revoke_session(uuid, uuid, uuid) TO rutaviva_runtime;
