CREATE TABLE app.network_releases (
  id uuid PRIMARY KEY,
  city_id uuid NOT NULL REFERENCES app.cities(id) ON DELETE RESTRICT,
  zone_id uuid NOT NULL REFERENCES app.zones(id) ON DELETE RESTRICT,
  version text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 80),
  source text NOT NULL DEFAULT 'OpenStreetMap' CHECK (source = 'OpenStreetMap'),
  source_date date NOT NULL,
  bbox double precision[] NOT NULL CHECK (array_length(bbox, 1) = 4),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','failed','retired')),
  node_count integer NOT NULL DEFAULT 0 CHECK (node_count BETWEEN 0 AND 10000),
  segment_count integer NOT NULL DEFAULT 0 CHECK (segment_count BETWEEN 0 AND 20000),
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  UNIQUE (city_id, version),
  CHECK ((status = 'published') = (published_at IS NOT NULL))
);

CREATE UNIQUE INDEX network_releases_one_published_zone
ON app.network_releases(zone_id) WHERE status = 'published';

ALTER TABLE app.route_nodes
  ADD COLUMN release_id uuid REFERENCES app.network_releases(id) ON DELETE CASCADE,
  ADD COLUMN source_node_id bigint,
  ADD CONSTRAINT route_nodes_release_source_unique UNIQUE (release_id, source_node_id);

ALTER TABLE app.route_segments
  ADD COLUMN release_id uuid REFERENCES app.network_releases(id) ON DELETE CASCADE,
  ADD COLUMN source_way_id bigint,
  ADD COLUMN source_sequence integer,
  ADD COLUMN name text CHECK (name IS NULL OR char_length(name) <= 160),
  ADD CONSTRAINT route_segments_release_source_unique UNIQUE (release_id, source_way_id, source_sequence, source_node_id, target_node_id);

CREATE INDEX route_nodes_release_idx ON app.route_nodes(release_id);
CREATE INDEX route_segments_release_idx ON app.route_segments(release_id);

ALTER TABLE app.contributions
  ADD COLUMN routing_valid_until timestamptz,
  ADD COLUMN routing_disputed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app_private.routing_validity_interval(p_kind text)
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT CASE p_kind
    WHEN 'closure' THEN interval '7 days'
    WHEN 'lighting' THEN interval '30 days'
    WHEN 'barrier' THEN interval '180 days'
    WHEN 'shortcut' THEN interval '180 days'
    WHEN 'accessible' THEN interval '365 days'
    ELSE interval '7 days'
  END;
$function$;

UPDATE app.contributions contribution
SET routing_valid_until = coalesce(contribution.published_at, contribution.updated_at, contribution.created_at, clock_timestamp())
  + app_private.routing_validity_interval(contribution.kind)
WHERE contribution.status='published';

CREATE OR REPLACE FUNCTION app_private.set_contribution_routing_validity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.status='published' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'published' OR OLD.kind IS DISTINCT FROM NEW.kind OR NEW.routing_valid_until IS NULL) THEN
    NEW.routing_valid_until := clock_timestamp() + app_private.routing_validity_interval(NEW.kind);
    NEW.routing_disputed := false;
  ELSIF NEW.status <> 'published' THEN
    NEW.routing_valid_until := NULL;
    NEW.routing_disputed := false;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER contributions_routing_validity
BEFORE INSERT OR UPDATE OF status, kind, routing_valid_until ON app.contributions
FOR EACH ROW EXECUTE FUNCTION app_private.set_contribution_routing_validity();

CREATE OR REPLACE FUNCTION app_private.refresh_contribution_routing_dispute()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE selected_id uuid; confirmations bigint; rejections bigint;
BEGIN
  selected_id := CASE WHEN TG_OP='DELETE' THEN OLD.contribution_id ELSE NEW.contribution_id END;
  SELECT count(*) FILTER (WHERE reaction.reaction='confirm'), count(*) FILTER (WHERE reaction.reaction='reject')
    INTO confirmations, rejections FROM app.contribution_reactions reaction WHERE reaction.contribution_id=selected_id;
  UPDATE app.contributions contribution
  SET routing_disputed = (rejections >= 2 AND rejections > confirmations)
  WHERE contribution.id=selected_id AND contribution.status='published';
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER contribution_reactions_refresh_routing_dispute
AFTER INSERT OR UPDATE OR DELETE ON app.contribution_reactions
FOR EACH ROW EXECUTE FUNCTION app_private.refresh_contribution_routing_dispute();

UPDATE app.contributions contribution
SET routing_disputed = (
  (SELECT count(*) FROM app.contribution_reactions reaction WHERE reaction.contribution_id=contribution.id AND reaction.reaction='reject') >= 2
  AND (SELECT count(*) FROM app.contribution_reactions reaction WHERE reaction.contribution_id=contribution.id AND reaction.reaction='reject')
    > (SELECT count(*) FROM app.contribution_reactions reaction WHERE reaction.contribution_id=contribution.id AND reaction.reaction='confirm')
)
WHERE contribution.status='published';

ALTER TABLE app.contributions ADD CONSTRAINT published_routing_validity_required
CHECK (status <> 'published' OR routing_valid_until IS NOT NULL);
CREATE INDEX contributions_routing_active_idx ON app.contributions(city_id, routing_valid_until)
WHERE status='published' AND routing_disputed=false;

REVOKE ALL ON app.network_releases FROM PUBLIC, rutaviva_runtime;
REVOKE ALL ON app.route_nodes, app.route_segments FROM rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.routing_validity_interval(text) FROM PUBLIC, rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.set_contribution_routing_validity() FROM PUBLIC, rutaviva_runtime;
REVOKE ALL ON FUNCTION app_private.refresh_contribution_routing_dispute() FROM PUBLIC, rutaviva_runtime;

COMMENT ON TABLE app.network_releases IS 'Versiones transaccionales de la red peatonal derivada de OpenStreetMap (ODbL).';
COMMENT ON COLUMN app.network_releases.source_date IS 'Fecha declarada de la instantánea OSM, no fecha de garantía del terreno.';
