INSERT INTO app.cities (id, slug, name, country_code, center, boundary, is_approximate)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'sevilla',
  'Sevilla',
  'ES',
  extensions.ST_SetSRID(extensions.ST_MakePoint(-5.9845, 37.3891), 4326),
  extensions.ST_GeomFromText('POLYGON((-6.10 37.31,-5.84 37.31,-5.84 37.46,-6.10 37.46,-6.10 37.31))', 4326),
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.zones (id, city_id, slug, name, sort_order, boundary, is_approximate)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'casco-antiguo',
    'Área piloto aproximada — Casco Antiguo',
    10,
    extensions.ST_Multi(extensions.ST_GeomFromText('POLYGON((-6.010 37.376,-5.978 37.376,-5.978 37.405,-6.010 37.405,-6.010 37.376))', 4326)),
    true
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'triana',
    'Área piloto aproximada — Triana',
    20,
    extensions.ST_Multi(extensions.ST_GeomFromText('POLYGON((-6.025 37.372,-6.000 37.372,-6.000 37.402,-6.025 37.402,-6.025 37.372))', 4326)),
    true
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'macarena',
    'Área piloto aproximada — Macarena',
    30,
    extensions.ST_Multi(extensions.ST_GeomFromText('POLYGON((-6.005 37.399,-5.974 37.399,-5.974 37.430,-6.005 37.430,-6.005 37.399))', 4326)),
    true
  )
ON CONFLICT (id) DO NOTHING;

-- El seed territorial es deliberadamente aproximado y no publica nodos ni tramos.
