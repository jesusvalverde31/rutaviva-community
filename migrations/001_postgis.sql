CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS app_private;

DO $postgis$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension extension
    JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'postgis' AND namespace.nspname <> 'extensions'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'postgis must be installed in extensions schema';
  END IF;
END;
$postgis$;

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON app_private.schema_migrations FROM PUBLIC;
GRANT USAGE ON SCHEMA app, app_private, extensions TO rutaviva_runtime;
GRANT SELECT ON app_private.schema_migrations TO rutaviva_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON SEQUENCES FROM PUBLIC;

COMMENT ON SCHEMA app IS 'Datos de aplicación de RutaViva Community';
COMMENT ON SCHEMA app_private IS 'Metadatos internos no expuestos por la API';
