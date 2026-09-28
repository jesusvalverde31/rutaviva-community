CREATE TABLE app.network_releases (
  id uuid PRIMARY KEY,
  city_id uuid NOT NULL REFERENCES app.cities(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, version),
  CHECK ((status = 'published' AND published_at IS NOT NULL) OR status <> 'published')
);

CREATE TABLE app_private.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid,
  actor_id uuid,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 100),
  resource_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);

CREATE OR REPLACE FUNCTION app_private.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'audit events are append-only';
END;
$function$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON app_private.audit_events
FOR EACH ROW EXECUTE FUNCTION app_private.reject_audit_mutation();

CREATE INDEX audit_events_occurred_idx ON app_private.audit_events (occurred_at DESC);
CREATE INDEX network_releases_city_status_idx ON app.network_releases (city_id, status);

REVOKE ALL ON app.network_releases FROM PUBLIC;
REVOKE ALL ON app_private.audit_events FROM PUBLIC;
REVOKE ALL ON app.network_releases FROM rutaviva_runtime;
REVOKE ALL ON app_private.audit_events FROM rutaviva_runtime;
