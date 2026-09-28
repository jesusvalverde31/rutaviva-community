CREATE TABLE app.cities (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  center extensions.geometry(Point, 4326) NOT NULL,
  boundary extensions.geometry(Polygon, 4326) NOT NULL,
  is_approximate boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extensions.ST_IsValid(boundary))
);

CREATE TABLE app.zones (
  id uuid PRIMARY KEY,
  city_id uuid NOT NULL REFERENCES app.cities(id) ON DELETE RESTRICT,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 1 AND 1000000),
  boundary extensions.geometry(MultiPolygon, 4326) NOT NULL,
  is_approximate boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, slug),
  UNIQUE (city_id, sort_order),
  CHECK (extensions.ST_IsValid(boundary))
);

CREATE TABLE app.route_nodes (
  id uuid PRIMARY KEY,
  city_id uuid NOT NULL REFERENCES app.cities(id) ON DELETE RESTRICT,
  position extensions.geometry(Point, 4326) NOT NULL,
  is_published boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.route_segments (
  id uuid PRIMARY KEY,
  city_id uuid NOT NULL REFERENCES app.cities(id) ON DELETE RESTRICT,
  source_node_id uuid NOT NULL REFERENCES app.route_nodes(id) ON DELETE RESTRICT,
  target_node_id uuid NOT NULL REFERENCES app.route_nodes(id) ON DELETE RESTRICT,
  geometry extensions.geometry(LineString, 4326) NOT NULL,
  distance_meters numeric(10,2) NOT NULL CHECK (distance_meters > 0 AND distance_meters <= 5000),
  accessibility_status text NOT NULL DEFAULT 'unknown' CHECK (accessibility_status IN ('unknown', 'compatible', 'barrier')),
  lighting_status text NOT NULL DEFAULT 'unknown' CHECK (lighting_status IN ('unknown', 'lit', 'poor')),
  is_published boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_node_id <> target_node_id),
  CHECK (extensions.ST_IsValid(geometry)),
  CHECK (extensions.ST_IsSimple(geometry)),
  CHECK (extensions.ST_NPoints(geometry) BETWEEN 2 AND 500)
);

CREATE OR REPLACE FUNCTION app_private.validate_city_boundary_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- El UPDATE ya bloquea esta ciudad. Los triggers hijos toman el mismo
  -- bloqueo antes de validar, por lo que no pueden insertar datos con el
  -- límite anterior mientras esta comprobación está en curso.
  IF NOT extensions.ST_Equals(NEW.boundary, OLD.boundary) AND (
    EXISTS (SELECT 1 FROM app.zones WHERE city_id = OLD.id AND NOT extensions.ST_CoveredBy(boundary, NEW.boundary))
    OR EXISTS (SELECT 1 FROM app.route_nodes WHERE city_id = OLD.id AND NOT extensions.ST_CoveredBy(position, NEW.boundary))
    OR EXISTS (SELECT 1 FROM app.route_segments WHERE city_id = OLD.id AND NOT extensions.ST_CoveredBy(geometry, NEW.boundary))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'city boundary must cover all existing territory and route data';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER cities_validate_boundary_change
BEFORE UPDATE OF boundary ON app.cities
FOR EACH ROW EXECUTE FUNCTION app_private.validate_city_boundary_change();

CREATE OR REPLACE FUNCTION app_private.validate_zone_boundary()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  city_boundary extensions.geometry(Polygon, 4326);
  previous_city_id uuid;
  locked_city record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_city_id := OLD.city_id;
  END IF;
  -- Una zona en movimiento bloquea ambas ciudades por UUID para que dos
  -- traslados opuestos no inviertan el orden de adquisición.
  FOR locked_city IN
    SELECT city.id, city.boundary
    FROM app.cities city
    WHERE city.id IN (NEW.city_id, previous_city_id)
    ORDER BY city.id
    FOR UPDATE
  LOOP
    IF locked_city.id = NEW.city_id THEN
      city_boundary := locked_city.boundary;
    END IF;
  END LOOP;
  IF city_boundary IS NULL OR NOT extensions.ST_CoveredBy(NEW.boundary, city_boundary) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'zone boundary must be covered by its city';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER zones_validate_boundary
BEFORE INSERT OR UPDATE OF city_id, boundary ON app.zones
FOR EACH ROW EXECUTE FUNCTION app_private.validate_zone_boundary();

CREATE OR REPLACE FUNCTION app_private.validate_route_node()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  city_boundary extensions.geometry(Polygon, 4326);
  previous_city_id uuid;
  locked_city record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_city_id := OLD.city_id;
  END IF;
  -- La propia fila del nodo ya está bloqueada por UPDATE. Después se toman
  -- las ciudades afectadas en orden UUID, igual que en el resto de triggers.
  FOR locked_city IN
    SELECT city.id, city.boundary
    FROM app.cities city
    WHERE city.id IN (NEW.city_id, previous_city_id)
    ORDER BY city.id
    FOR UPDATE
  LOOP
    IF locked_city.id = NEW.city_id THEN
      city_boundary := locked_city.boundary;
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE'
     AND (NEW.city_id IS DISTINCT FROM OLD.city_id OR NOT extensions.ST_Equals(NEW.position, OLD.position))
     AND EXISTS (
       SELECT 1 FROM app.route_segments
       WHERE source_node_id = OLD.id OR target_node_id = OLD.id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'referenced route node cannot move or change city';
  END IF;
  IF city_boundary IS NULL OR NOT extensions.ST_CoveredBy(NEW.position, city_boundary) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'route node must be covered by its city';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER route_nodes_validate_position
BEFORE INSERT OR UPDATE OF city_id, position ON app.route_nodes
FOR EACH ROW EXECUTE FUNCTION app_private.validate_route_node();

CREATE OR REPLACE FUNCTION app_private.validate_segment_endpoints()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  source_position extensions.geometry(Point, 4326);
  target_position extensions.geometry(Point, 4326);
  city_boundary extensions.geometry(Polygon, 4326);
  measured_distance numeric;
  previous_city_id uuid;
  previous_source_node_id uuid;
  previous_target_node_id uuid;
  locked_node record;
  locked_city record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_city_id := OLD.city_id;
    previous_source_node_id := OLD.source_node_id;
    previous_target_node_id := OLD.target_node_id;
  END IF;
  -- Orden global de bloqueos: fila propia del segmento (implícita en UPDATE),
  -- nodos por UUID y finalmente ciudades por UUID. Los triggers de nodo
  -- siguen el orden nodo -> ciudad, evitando la inversión más peligrosa.
  FOR locked_node IN
    SELECT node.id, node.city_id, node.position
    FROM app.route_nodes node
    WHERE node.id IN (
      NEW.source_node_id,
      NEW.target_node_id,
      previous_source_node_id,
      previous_target_node_id
    )
    ORDER BY node.id
    FOR UPDATE
  LOOP
    IF locked_node.id = NEW.source_node_id AND locked_node.city_id = NEW.city_id THEN
      source_position := locked_node.position;
    END IF;
    IF locked_node.id = NEW.target_node_id AND locked_node.city_id = NEW.city_id THEN
      target_position := locked_node.position;
    END IF;
  END LOOP;
  FOR locked_city IN
    SELECT city.id, city.boundary
    FROM app.cities city
    WHERE city.id IN (NEW.city_id, previous_city_id)
    ORDER BY city.id
    FOR UPDATE
  LOOP
    IF locked_city.id = NEW.city_id THEN
      city_boundary := locked_city.boundary;
    END IF;
  END LOOP;
  IF source_position IS NULL OR target_position IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'segment endpoints must belong to its city';
  END IF;
  IF city_boundary IS NULL OR NOT extensions.ST_CoveredBy(NEW.geometry, city_boundary) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'segment geometry must be covered by its city';
  END IF;
  IF NOT extensions.ST_DWithin(extensions.ST_StartPoint(NEW.geometry)::extensions.geography, source_position::extensions.geography, 5)
     OR NOT extensions.ST_DWithin(extensions.ST_EndPoint(NEW.geometry)::extensions.geography, target_position::extensions.geography, 5) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'segment geometry must match its endpoints';
  END IF;
  measured_distance := extensions.ST_Length(NEW.geometry::extensions.geography);
  IF measured_distance <= 0 OR measured_distance > 5000 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'segment distance must be greater than zero and at most 5000 meters';
  END IF;
  NEW.distance_meters := round(measured_distance, 2);
  RETURN NEW;
END;
$function$;

CREATE TRIGGER route_segments_validate_endpoints
BEFORE INSERT OR UPDATE OF city_id, source_node_id, target_node_id, geometry, distance_meters
ON app.route_segments
FOR EACH ROW EXECUTE FUNCTION app_private.validate_segment_endpoints();

CREATE INDEX cities_boundary_gist ON app.cities USING gist (boundary);
CREATE INDEX zones_boundary_gist ON app.zones USING gist (boundary);
CREATE INDEX route_nodes_position_gist ON app.route_nodes USING gist (position);
CREATE INDEX route_segments_geometry_gist ON app.route_segments USING gist (geometry);
CREATE INDEX route_segments_source_idx ON app.route_segments (source_node_id);
CREATE INDEX route_segments_target_idx ON app.route_segments (target_node_id);

REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON app.cities, app.zones, app.route_nodes, app.route_segments FROM rutaviva_runtime;
GRANT SELECT ON app.cities, app.zones TO rutaviva_runtime;
