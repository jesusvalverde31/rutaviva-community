'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BOOTSTRAP_SQL = `
SELECT
  city.id,
  city.slug,
  city.name,
  city.country_code AS "countryCode",
  city.is_approximate AS "isApproximate",
  extensions.ST_Y(city.center) AS latitude,
  extensions.ST_X(city.center) AS longitude,
  COUNT(zone.id)::integer AS "zoneCount"
FROM app.cities city
LEFT JOIN app.zones zone ON zone.city_id = city.id AND zone.is_active = true
WHERE city.slug = $1 AND city.is_active = true
GROUP BY city.id
`;

const ZONES_SQL = `
SELECT
  zone.id,
  zone.slug,
  zone.name,
  zone.sort_order AS "sortOrder",
  zone.is_approximate AS "isApproximate",
  json_build_array(
    extensions.ST_XMin(extensions.box3d(zone.boundary)),
    extensions.ST_YMin(extensions.box3d(zone.boundary)),
    extensions.ST_XMax(extensions.box3d(zone.boundary)),
    extensions.ST_YMax(extensions.box3d(zone.boundary))
  ) AS bbox
FROM app.zones zone
JOIN app.cities city ON city.id = zone.city_id
WHERE city.slug = $1
  AND city.is_active = true
  AND zone.is_active = true
  AND ($2::text IS NULL OR zone.name ILIKE '%' || $2 || '%')
  AND ($3::integer IS NULL OR (zone.sort_order, zone.id) > ($3::integer, $4::uuid))
ORDER BY zone.sort_order, zone.id
LIMIT $5
`;

function invalidCursor() {
  const error = new Error('invalid cursor');
  error.code = 'INVALID_CURSOR';
  return error;
}

function validSortOrder(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000;
}

function encodeCursor(zone) {
  if (!validSortOrder(zone.sortOrder) || !UUID.test(zone.id)) throw invalidCursor();
  return Buffer.from(JSON.stringify({ v: 1, s: zone.sortOrder, i: zone.id }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw invalidCursor();
    const cursor = JSON.parse(decoded.toString('utf8'));
    if (Object.keys(cursor).sort().join(',') !== 'i,s,v' || cursor.v !== 1 || !validSortOrder(cursor.s) || !UUID.test(cursor.i)) throw invalidCursor();
    return { sortOrder: cursor.s, id: cursor.i };
  } catch (error) {
    if (error.code === 'INVALID_CURSOR') throw error;
    throw invalidCursor();
  }
}

async function getBootstrap(database) {
  const result = await database.query(BOOTSTRAP_SQL, ['sevilla']);
  return result.rows[0] || null;
}

async function listZones(database, filters) {
  const cursor = decodeCursor(filters.cursor);
  const result = await database.query(ZONES_SQL, [
    'sevilla',
    filters.search || null,
    cursor?.sortOrder || null,
    cursor?.id || null,
    filters.limit + 1
  ]);
  const hasMore = result.rows.length > filters.limit;
  const data = result.rows.slice(0, filters.limit);
  return {
    data,
    page: { limit: filters.limit, nextCursor: hasMore ? encodeCursor(data.at(-1)) : null }
  };
}

module.exports = { BOOTSTRAP_SQL, ZONES_SQL, decodeCursor, encodeCursor, getBootstrap, listZones };
