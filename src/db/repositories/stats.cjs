'use strict';

const { AppError } = require('../../errors.cjs');

const SQL = Object.freeze({
  stats: 'SELECT * FROM app_private.community_stats()',
  leaderboard: 'SELECT * FROM app_private.zone_leaderboard()',
  summary: 'SELECT * FROM app_private.activity_summary()'
});

function mapCredibilityError(error) {
  if (error instanceof AppError) throw error;
  throw new AppError(503, 'CREDIBILITY_UNAVAILABLE', 'Las estadísticas públicas no están disponibles temporalmente.');
}

function createStatsRepository(database) {
  const query = async sql => {
    try { return (await database.query(sql)).rows; }
    catch (error) { return mapCredibilityError(error); }
  };
  return {
    stats: () => query(SQL.stats).then(rows => rows[0] || null),
    leaderboard: () => query(SQL.leaderboard),
    summary: () => query(SQL.summary)
  };
}

module.exports = { SQL, createStatsRepository, mapCredibilityError };
