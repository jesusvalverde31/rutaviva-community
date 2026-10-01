ALTER TABLE app.network_releases
  DROP CONSTRAINT network_releases_node_count_check,
  DROP CONSTRAINT network_releases_segment_count_check;

ALTER TABLE app.network_releases
  ADD CONSTRAINT network_releases_node_count_check CHECK (node_count BETWEEN 0 AND 15000),
  ADD CONSTRAINT network_releases_segment_count_check CHECK (segment_count BETWEEN 0 AND 30000);

COMMENT ON COLUMN app.network_releases.node_count IS 'Límite operativo validado del piloto: 15.000 nodos por release.';
COMMENT ON COLUMN app.network_releases.segment_count IS 'Límite operativo validado del piloto: 30.000 tramos dirigidos por release.';
