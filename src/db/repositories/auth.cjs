'use strict';

const { AppError } = require('../../errors.cjs');

const REQUEST_LINK_SQL = `SELECT app_private.request_magic_link(
  $1::uuid, $2::uuid, $3::bytea, $4::bytea, $5::bytea, $6::bytea, $7::bytea, $8::bytea,
  $9::bytea, $10::bytea, $11::bytea, $12::bytea, $13::text, $14::bytea, $15::uuid
) AS result`;
const VERIFY_SQL = `SELECT * FROM app_private.verify_magic_link(
  $1::uuid, $2::bytea, $3::bytea, $4::uuid, $5::uuid, $6::uuid, $7::bytea, $8::text, $9::uuid
)`;
const AUTHENTICATE_SQL = 'SELECT * FROM app_private.authenticate_session($1::bytea)';
const LIST_SESSIONS_SQL = 'SELECT * FROM app_private.list_sessions($1::uuid)';
const REVOKE_SESSION_SQL = 'SELECT app_private.revoke_session($1::uuid, $2::uuid, $3::uuid) AS revoked';

function mapDatabaseError(error) {
  if (error?.code === 'P0001' && error?.message === 'idempotency_conflict') {
    throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'La clave de idempotencia ya se utilizó con otros datos.');
  }
  throw new AppError(503, 'AUTHENTICATION_UNAVAILABLE', 'El acceso no está disponible temporalmente.');
}

function createAuthRepository(database) {
  return {
    async requestMagicLink(input) {
      try {
        const values = [
          input.verificationId, input.outboxId, input.emailHash, input.ipHash, input.globalHash,
          input.encryptedEmail.ciphertext, input.encryptedEmail.nonce, input.encryptedEmail.tag,
          input.tokenHash, input.encryptedOutbox.ciphertext, input.encryptedOutbox.nonce,
          input.encryptedOutbox.tag, input.idempotencyKey, input.requestHash, input.requestId
        ];
        const result = await database.query(REQUEST_LINK_SQL, values);
        return result.rows[0]?.result || { accepted: true };
      } catch (error) { return mapDatabaseError(error); }
    },
    async verifyMagicLink(input) {
      try {
        const values = [input.verificationId, input.tokenHash, input.ipHash, input.userId, input.identityId, input.sessionId, input.sessionTokenHash, input.publicAlias, input.requestId];
        const result = await database.query(VERIFY_SQL, values);
        return result.rows[0] || { authenticated: false };
      } catch (error) { return mapDatabaseError(error); }
    },
    async authenticate(tokenHash) {
      try {
        const result = await database.query(AUTHENTICATE_SQL, [tokenHash]);
        return result.rows[0] || null;
      } catch (error) { return mapDatabaseError(error); }
    },
    async listSessions(sessionId) {
      try { return (await database.query(LIST_SESSIONS_SQL, [sessionId])).rows; }
      catch (error) { return mapDatabaseError(error); }
    },
    async revokeSession(actorSessionId, targetSessionId, requestId) {
      try {
        const result = await database.query(REVOKE_SESSION_SQL, [actorSessionId, targetSessionId, requestId]);
        return result.rows[0]?.revoked === true;
      } catch (error) { return mapDatabaseError(error); }
    }
  };
}

module.exports = {
  AUTHENTICATE_SQL,
  LIST_SESSIONS_SQL,
  REQUEST_LINK_SQL,
  REVOKE_SESSION_SQL,
  VERIFY_SQL,
  createAuthRepository
};
