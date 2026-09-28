ALTER TABLE app_private.outbox_events
  ADD COLUMN lease_owner uuid,
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN last_failure_code text,
  ADD COLUMN provider_message_hash bytea,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT outbox_lease_consistency CHECK (
    (status = 'processing' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT outbox_failure_code_safe CHECK (
    last_failure_code IS NULL OR last_failure_code ~ '^[A-Z0-9_]{1,64}$'
  ),
  ADD CONSTRAINT outbox_provider_message_hash_length CHECK (
    provider_message_hash IS NULL OR octet_length(provider_message_hash) = 32
  );

DROP INDEX app_private.outbox_pending_idx;
CREATE INDEX outbox_deliverable_idx
  ON app_private.outbox_events (available_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION app_private.claim_email_delivery(
  p_worker_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer
) RETURNS TABLE (
  event_id uuid,
  event_type text,
  payload_ciphertext bytea,
  payload_nonce bytea,
  payload_tag bytea,
  delivery_key uuid,
  attempt smallint,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  selected_id uuid;
BEGIN
  IF p_worker_id IS NULL OR p_lease_token IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_delivery_lease';
  END IF;

  WITH invalid AS (
    SELECT outbox.id
    FROM app_private.outbox_events AS outbox
    JOIN app_private.email_verifications AS verification ON verification.id = outbox.verification_id
    WHERE outbox.status IN ('pending', 'processing')
      AND (
        verification.consumed_at IS NOT NULL
        OR verification.revoked_at IS NOT NULL
        OR verification.expires_at <= clock_timestamp()
      )
    FOR UPDATE OF outbox SKIP LOCKED
  ), cancelled AS (
    UPDATE app_private.outbox_events AS outbox
    SET status = 'cancelled', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, updated_at = clock_timestamp()
    FROM invalid
    WHERE outbox.id = invalid.id
    RETURNING outbox.id
  )
  INSERT INTO app_private.audit_events (action, resource_type, resource_id, details)
  SELECT 'email.delivery_cancelled', 'outbox_event', cancelled.id,
         jsonb_build_object('reason', 'verification_unavailable')
  FROM cancelled;

  WITH exhausted AS (
    UPDATE app_private.outbox_events AS outbox
    SET status = 'failed', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, last_failure_code = 'LEASE_EXPIRED',
        updated_at = clock_timestamp()
    WHERE outbox.status = 'processing'
      AND outbox.lease_expires_at <= clock_timestamp()
      AND outbox.attempts >= 5
    RETURNING outbox.id, outbox.attempts
  )
  INSERT INTO app_private.audit_events (action, resource_type, resource_id, details)
  SELECT 'email.delivery_failed', 'outbox_event', exhausted.id,
         jsonb_build_object('attempt', exhausted.attempts, 'failure_code', 'LEASE_EXPIRED')
  FROM exhausted;

  UPDATE app_private.outbox_events AS outbox
  SET status = 'pending', lease_owner = NULL, lease_token = NULL,
      lease_expires_at = NULL, available_at = clock_timestamp(),
      last_failure_code = 'LEASE_EXPIRED', updated_at = clock_timestamp()
  WHERE outbox.status = 'processing'
    AND outbox.lease_expires_at <= clock_timestamp()
    AND outbox.attempts < 5;

  SELECT outbox.id INTO selected_id
  FROM app_private.outbox_events AS outbox
  JOIN app_private.email_verifications AS verification ON verification.id = outbox.verification_id
  WHERE outbox.status = 'pending'
    AND outbox.available_at <= clock_timestamp()
    AND outbox.attempts < 5
    AND verification.consumed_at IS NULL
    AND verification.revoked_at IS NULL
    AND verification.expires_at > clock_timestamp()
  ORDER BY outbox.available_at, outbox.created_at, outbox.id
  FOR UPDATE OF outbox SKIP LOCKED
  LIMIT 1;

  IF selected_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE app_private.outbox_events AS outbox
  SET status = 'processing', attempts = outbox.attempts + 1,
      lease_owner = p_worker_id, lease_token = p_lease_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  WHERE outbox.id = selected_id
  RETURNING outbox.id, outbox.event_type, outbox.payload_ciphertext,
            outbox.payload_nonce, outbox.payload_tag, outbox.id,
            outbox.attempts, outbox.lease_expires_at;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.complete_email_delivery(
  p_event_id uuid,
  p_worker_id uuid,
  p_lease_token uuid,
  p_provider_message_hash bytea,
  p_request_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  changed uuid;
  completed_attempt smallint;
BEGIN
  IF octet_length(p_provider_message_hash) <> 32 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_provider_message_hash';
  END IF;
  UPDATE app_private.outbox_events AS outbox
  SET status = 'sent', sent_at = clock_timestamp(), provider_message_hash = p_provider_message_hash,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      last_failure_code = NULL, updated_at = clock_timestamp()
  WHERE outbox.id = p_event_id AND outbox.status = 'processing'
    AND outbox.lease_owner = p_worker_id AND outbox.lease_token = p_lease_token
    AND outbox.lease_expires_at > clock_timestamp()
  RETURNING outbox.id, outbox.attempts INTO changed, completed_attempt;
  IF changed IS NOT NULL THEN
    INSERT INTO app_private.audit_events (request_id, action, resource_type, resource_id, details)
    VALUES (p_request_id, 'email.delivery_sent', 'outbox_event', changed,
            jsonb_build_object('attempt', completed_attempt));
  END IF;
  RETURN changed IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.fail_email_delivery(
  p_event_id uuid,
  p_worker_id uuid,
  p_lease_token uuid,
  p_failure_code text,
  p_retryable boolean,
  p_request_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  selected_attempt smallint;
  next_status text;
BEGIN
  IF p_failure_code IS NULL OR p_failure_code !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_failure_code';
  END IF;
  SELECT outbox.attempts INTO selected_attempt
  FROM app_private.outbox_events AS outbox
  WHERE outbox.id = p_event_id AND outbox.status = 'processing'
    AND outbox.lease_owner = p_worker_id AND outbox.lease_token = p_lease_token
    AND outbox.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF selected_attempt IS NULL THEN RETURN 'lease_lost'; END IF;

  next_status := CASE WHEN p_retryable AND selected_attempt < 5 THEN 'pending' ELSE 'failed' END;
  UPDATE app_private.outbox_events AS outbox
  SET status = next_status, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      last_failure_code = p_failure_code,
      available_at = CASE selected_attempt
        WHEN 1 THEN clock_timestamp() + interval '1 minute'
        WHEN 2 THEN clock_timestamp() + interval '5 minutes'
        WHEN 3 THEN clock_timestamp() + interval '15 minutes'
        ELSE clock_timestamp() + interval '1 hour'
      END,
      updated_at = clock_timestamp()
  WHERE outbox.id = p_event_id;
  INSERT INTO app_private.audit_events (request_id, action, resource_type, resource_id, details)
  VALUES (p_request_id,
          CASE WHEN next_status = 'pending' THEN 'email.delivery_retry_scheduled' ELSE 'email.delivery_failed' END,
          'outbox_event', p_event_id,
          jsonb_build_object('attempt', selected_attempt, 'failure_code', p_failure_code));
  RETURN next_status;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.claim_email_delivery(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.complete_email_delivery(uuid, uuid, uuid, bytea, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.fail_email_delivery(uuid, uuid, uuid, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.claim_email_delivery(uuid, uuid, integer) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.complete_email_delivery(uuid, uuid, uuid, bytea, uuid) TO rutaviva_runtime;
GRANT EXECUTE ON FUNCTION app_private.fail_email_delivery(uuid, uuid, uuid, text, boolean, uuid) TO rutaviva_runtime;

REVOKE ALL ON app_private.outbox_events FROM rutaviva_runtime;
