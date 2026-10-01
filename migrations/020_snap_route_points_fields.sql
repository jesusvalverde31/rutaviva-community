CREATE OR REPLACE FUNCTION app_private.snap_route_points(
  p_release_id uuid,
  p_origin_longitude double precision,
  p_origin_latitude double precision,
  p_destination_longitude double precision,
  p_destination_latitude double precision,
  p_max_snap_meters double precision
) RETURNS TABLE (
  origin_node_id uuid,
  origin_offset_meters double precision,
  destination_node_id uuid,
  destination_offset_meters double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $function$
DECLARE
  zone_boundary extensions.geometry(MultiPolygon,4326);
  origin_point extensions.geometry(Point,4326);
  destination_point extensions.geometry(Point,4326);
  nearest_origin_id uuid;
  nearest_origin_offset double precision;
  nearest_destination_id uuid;
  nearest_destination_offset double precision;
BEGIN
  IF p_max_snap_meters <= 0 OR p_max_snap_meters > 75 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_snap_distance';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.network_releases release
    WHERE release.id=p_release_id AND release.status='published'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='routing_data_not_ready';
  END IF;

  origin_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_origin_longitude,p_origin_latitude),4326);
  destination_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_destination_longitude,p_destination_latitude),4326);

  SELECT zone.boundary
  INTO zone_boundary
  FROM app.zones zone
  WHERE zone.id='20000000-0000-4000-8000-000000000001'::uuid AND zone.is_active;

  IF zone_boundary IS NULL
    OR NOT extensions.ST_CoveredBy(origin_point,zone_boundary)
    OR NOT extensions.ST_CoveredBy(destination_point,zone_boundary) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outside_pilot';
  END IF;

  SELECT
    node.id,
    extensions.ST_Distance(node.position::extensions.geography,origin_point::extensions.geography)
  INTO nearest_origin_id, nearest_origin_offset
  FROM app.route_nodes node
  WHERE node.release_id=p_release_id
    AND node.is_published
    AND extensions.ST_DWithin(node.position::extensions.geography,origin_point::extensions.geography,p_max_snap_meters)
  ORDER BY node.position <-> origin_point,node.id
  LIMIT 1;

  SELECT
    node.id,
    extensions.ST_Distance(node.position::extensions.geography,destination_point::extensions.geography)
  INTO nearest_destination_id, nearest_destination_offset
  FROM app.route_nodes node
  WHERE node.release_id=p_release_id
    AND node.is_published
    AND extensions.ST_DWithin(node.position::extensions.geography,destination_point::extensions.geography,p_max_snap_meters)
  ORDER BY node.position <-> destination_point,node.id
  LIMIT 1;

  IF nearest_origin_id IS NULL OR nearest_destination_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='no_nearby_network';
  END IF;

  RETURN QUERY SELECT
    nearest_origin_id,
    nearest_origin_offset,
    nearest_destination_id,
    nearest_destination_offset;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.snap_route_points(uuid,double precision,double precision,double precision,double precision,double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.snap_route_points(uuid,double precision,double precision,double precision,double precision,double precision) TO rutaviva_runtime;

COMMENT ON FUNCTION app_private.snap_route_points(uuid,double precision,double precision,double precision,double precision,double precision)
  IS 'Ajusta origen y destino a nodos publicados y devuelve identificadores y distancias mediante variables escalares explícitas.';
