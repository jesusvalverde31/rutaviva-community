'use strict';

const CLAIM_SQL = 'SELECT * FROM app_private.claim_email_delivery($1::uuid, $2::uuid, $3::integer)';
const COMPLETE_SQL = 'SELECT app_private.complete_email_delivery($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::uuid) AS completed';
const FAIL_SQL = 'SELECT app_private.fail_email_delivery($1::uuid, $2::uuid, $3::uuid, $4::text, $5::boolean, $6::uuid) AS status';

function createOutboxRepository(database) {
  if (!database || typeof database.query !== 'function') throw new TypeError('Se requiere una conexión de base de datos.');
  return {
    async claim(workerId, leaseToken, leaseSeconds) {
      const result = await database.query(CLAIM_SQL, [workerId, leaseToken, leaseSeconds]);
      return result.rows[0] || null;
    },
    async complete(eventId, workerId, leaseToken, providerMessageHash, requestId) {
      const result = await database.query(COMPLETE_SQL, [eventId, workerId, leaseToken, providerMessageHash, requestId]);
      return result.rows[0]?.completed === true;
    },
    async fail(eventId, workerId, leaseToken, failureCode, retryable, requestId) {
      const result = await database.query(FAIL_SQL, [eventId, workerId, leaseToken, failureCode, retryable, requestId]);
      return result.rows[0]?.status || 'lease_lost';
    }
  };
}

module.exports = { CLAIM_SQL, COMPLETE_SQL, FAIL_SQL, createOutboxRepository };
