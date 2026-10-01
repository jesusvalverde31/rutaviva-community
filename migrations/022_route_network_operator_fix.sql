-- Corrige de forma forward-only la resolución del operador KNN sustituida por 021.
CREATE OR REPLACE FUNCTION app_private.get_route_network(
  p_origin_longitude double precision,p_origin_latitude double precision,p_destination_longitude double precision,p_destination_latitude double precision,p_max_snap_meters double precision
) RETURNS TABLE(
  release_id uuid,release_version text,osm_date date,imported_at timestamptz,origin_node_id uuid,origin_offset_meters double precision,
  destination_node_id uuid,destination_offset_meters double precision,segment_id uuid,source_node_id uuid,target_node_id uuid,segment_name text,
  distance_meters numeric,accessibility_status text,lighting_status text,geometry text,source_latitude double precision,source_longitude double precision,
  target_latitude double precision,target_longitude double precision,contributions jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
DECLARE selected_release app.network_releases%ROWTYPE;zone_boundary extensions.geometry(MultiPolygon,4326);origin_point extensions.geometry(Point,4326);destination_point extensions.geometry(Point,4326);nearest_origin record;nearest_destination record;
BEGIN
  IF p_max_snap_meters<=0 OR p_max_snap_meters>75 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_snap_distance'; END IF;
  origin_point:=extensions.ST_SetSRID(extensions.ST_MakePoint(p_origin_longitude,p_origin_latitude),4326);
  destination_point:=extensions.ST_SetSRID(extensions.ST_MakePoint(p_destination_longitude,p_destination_latitude),4326);
  SELECT zone.boundary INTO zone_boundary FROM app.zones zone WHERE zone.id='20000000-0000-4000-8000-000000000001'::uuid AND zone.is_active;
  IF zone_boundary IS NULL OR NOT extensions.ST_CoveredBy(origin_point,zone_boundary) OR NOT extensions.ST_CoveredBy(destination_point,zone_boundary) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='outside_pilot'; END IF;
  SELECT release.* INTO selected_release FROM app.network_releases release WHERE release.zone_id='20000000-0000-4000-8000-000000000001'::uuid AND release.status='published' ORDER BY release.published_at DESC,release.id LIMIT 1;
  IF selected_release.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='routing_data_not_ready'; END IF;
  SELECT node.id,extensions.ST_Distance(node.position::extensions.geography,origin_point::extensions.geography) AS offset_meters INTO nearest_origin
    FROM app.route_nodes node WHERE node.release_id=selected_release.id AND node.is_published AND extensions.ST_DWithin(node.position::extensions.geography,origin_point::extensions.geography,p_max_snap_meters)
    ORDER BY node.position OPERATOR(extensions.<->) origin_point,node.id LIMIT 1;
  SELECT node.id,extensions.ST_Distance(node.position::extensions.geography,destination_point::extensions.geography) AS offset_meters INTO nearest_destination
    FROM app.route_nodes node WHERE node.release_id=selected_release.id AND node.is_published AND extensions.ST_DWithin(node.position::extensions.geography,destination_point::extensions.geography,p_max_snap_meters)
    ORDER BY node.position OPERATOR(extensions.<->) destination_point,node.id LIMIT 1;
  IF nearest_origin.id IS NULL OR nearest_destination.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='no_nearby_network'; END IF;
  RETURN QUERY SELECT selected_release.id,selected_release.version,selected_release.source_date,selected_release.imported_at,
    nearest_origin.id,nearest_origin.offset_meters,nearest_destination.id,nearest_destination.offset_meters,segment.id,segment.source_node_id,segment.target_node_id,segment.name,
    segment.distance_meters,segment.accessibility_status,segment.lighting_status,extensions.ST_AsGeoJSON(segment.geometry,6),
    extensions.ST_Y(source.position),extensions.ST_X(source.position),extensions.ST_Y(target.position),extensions.ST_X(target.position),coalesce(impact.items,'[]'::jsonb)
  FROM app.route_segments segment JOIN app.route_nodes source ON source.id=segment.source_node_id AND source.release_id=selected_release.id AND source.is_published
  JOIN app.route_nodes target ON target.id=segment.target_node_id AND target.release_id=selected_release.id AND target.is_published
  LEFT JOIN LATERAL(
    SELECT jsonb_agg(jsonb_build_object('kind',item.kind,'title',item.title,'status',item.status,'confidence',item.confidence,'measurementStatus',item.measurement_status,'lifecycleStatus',item.lifecycle_status) ORDER BY item.id) AS items
    FROM(
      SELECT contribution.id,contribution.kind,contribution.title,contribution.status,contribution.measurement_status,contribution.lifecycle_status,
        least(1.0,greatest(0.0,0.5+0.1*count(reaction.*) FILTER(WHERE reaction.reaction='confirm')-0.15*count(reaction.*) FILTER(WHERE reaction.reaction='reject'))) AS confidence
      FROM app.contributions contribution LEFT JOIN app.contribution_reactions reaction ON reaction.contribution_id=contribution.id
      WHERE contribution.status='published' AND contribution.routing_disputed=false AND contribution.routing_valid_until>statement_timestamp()
        AND contribution.city_id=selected_release.city_id AND app_private.contribution_affects_segment(contribution.geometry,segment.geometry,segment.distance_meters)
      GROUP BY contribution.id
    ) item
  ) impact ON true WHERE segment.release_id=selected_release.id AND segment.is_published ORDER BY segment.id;
END;$function$;

REVOKE ALL ON FUNCTION app_private.get_route_network(double precision,double precision,double precision,double precision,double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.get_route_network(double precision,double precision,double precision,double precision,double precision) TO rutaviva_runtime;

COMMENT ON FUNCTION app_private.get_route_network(double precision,double precision,double precision,double precision,double precision)
  IS 'Devuelve la red peatonal con evidencia de accesibilidad; los operadores KNN PostGIS se resuelven explícitamente en extensions.';
