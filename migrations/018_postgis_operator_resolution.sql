REVOKE CREATE ON SCHEMA extensions FROM PUBLIC, rutaviva_runtime;
GRANT USAGE ON SCHEMA extensions TO rutaviva_runtime;

ALTER FUNCTION app_private.snap_route_points(uuid,double precision,double precision,double precision,double precision,double precision)
  SET search_path = pg_catalog, extensions;

ALTER FUNCTION app_private.get_route_network(double precision,double precision,double precision,double precision,double precision)
  SET search_path = pg_catalog, extensions;

COMMENT ON FUNCTION app_private.snap_route_points(uuid,double precision,double precision,double precision,double precision,double precision)
  IS 'Ajusta origen y destino a nodos publicados; extensions en search_path resuelve de forma segura el operador KNN de PostGIS.';

COMMENT ON FUNCTION app_private.get_route_network(double precision,double precision,double precision,double precision,double precision)
  IS 'Devuelve el grafo peatonal publicado; extensions en search_path resuelve de forma segura el operador KNN de PostGIS.';
