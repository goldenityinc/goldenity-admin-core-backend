/**
 * dbSafe.js — PostgreSQL `pg` library safe client + transaction wrappers.
 *
 * CRITICAL BUG PREVENTION
 * -----------------------
 * pg PoolClient ERROR: "Client has already been connected. You cannot reuse a client."
 *   This error happens if you:
 *     1) call pool.connect() to acquire a PoolClient (PoolClient is ALREADY connected),
 *        THEN you mistakenly call poolClient.connect() AGAIN.
 *     2) you call client.connect() twice on the same `new Client(...)` instance.
 *     3) you call .query() / .release() on a PoolClient that was already .release()'d
 *        (double-release) and then try to reuse it.
 *
 * The wrappers below ELIMINATE those footguns. Treat this file as the SOLE entrypoint
 * whenever you need to use `pg` Pool / Client by hand (outside Prisma query path).
 *
 * Usage:
 *   const { getClientFromPool, runTransaction, withTransaction, tryConnectOnce, tryReleaseOnce }
 *     = require('./dbSafe');
 *
 *   // SAFE acquire from pool (we NEVER call .connect() on the PoolClient returned by pool.connect())
 *   const { client, release } = await getClientFromPool(pool);
 *   try { ... } finally { release(); }
 *
 *   // SAFE transaction (BEGIN ... COMMIT/ROLLBACK, acquire + release exactly once)
 *   const result = await runTransaction(pool, async (client) => {
 *     return client.query('SELECT 1');
 *   });
 *
 *   // SAFE transaction with retry on transient errors (deadlock / serialization)
 *   const result = await withTransaction(pool, { maxAttempts: 5 }, async (client) => {
 *     return client.query('SELECT 1');
 *   });
 */

'use strict';

const TRANSIENT_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '55006', // object_in_use
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08006', // connection_failure
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
]);

function isTransientPgError(err) {
  if (!err) return false;
  const code = typeof err.code === 'string' ? err.code : '';
  const sqlstate = typeof err.sqlState === 'string'
    ? err.sqlState
    : typeof err.sqlstate === 'string'
      ? err.sqlstate
      : '';
  const msg = err.message ? String(err.message) : '';
  if (TRANSIENT_SQLSTATES.has(sqlstate)) return true;
  if (TRANSIENT_SQLSTATES.has(code)) return true;
  const up = msg.toUpperCase();
  return (
    up.includes('DEADLOCK') ||
    up.includes('SERIALIZATION') ||
    up.includes('COULD NOT SERIALIZE') ||
    up.includes('CONNECTION POOL') ||
    up.includes('CONNECTION REFUSED') ||
    up.includes('CONNECTION RESET') ||
    up.includes('CONNECTION ABORTED') ||
    up.includes('TIMEOUT') ||
    up.includes('TIMED OUT') ||
    up.includes('TOO MANY CONNECTIONS') ||
    up.includes('CLIENT HAS ALREADY BEEN CONNECTED') ||
    up.includes('CANNOT REUSE A CLIENT') ||
    up.includes('LOCK WAIT TIMEOUT')
  );
}

function _isPoolClient(client) {
  return (
    client &&
    typeof client === 'object' &&
    typeof client.release === 'function' &&
    // PoolClient has a reference to the pool via private member or constructor name === 'Client'
    (client.constructor && client.constructor.name === 'Client')
  );
}

function _isConnected(client) {
  if (!client) return false;
  // pg.Client / PoolClient exposes these as semi-public state.
  const connectedPrivate = typeof client._connected === 'boolean' ? client._connected : null;
  const connectionOpen =
    client.connection &&
    client.connection.stream &&
    (typeof client.connection.stream.writable === 'boolean'
      ? client.connection.stream.writable
      : typeof client.connection.stream.destroyed === 'boolean'
        ? !client.connection.stream.destroyed
        : true);
  if (connectedPrivate !== null) return connectedPrivate === true;
  return connectionOpen === true;
}

/**
 * Connect a brand-new standalone `new Client(...)` EXACTLY ONCE.
 * If it was already connected (via cache reuse / double-call bug), this SKIPS
 * `.connect()` and returns `{ connected: false, alreadyConnected: true }`.
 *
 * Use this anywhere you would otherwise write: `await client.connect();`
 * This guarantees we NEVER trigger the "already connected" error.
 */
async function tryConnectOnce(client, opts = {}) {
  const label = opts.label || 'standalone';
  if (!client) {
    throw new Error(`[dbSafe.tryConnectOnce:${label}] client is null/undefined`);
  }
  const already = _isConnected(client);
  if (already) {
    // DO NOT call .connect() again — that throws "Client has already been connected."
    if (opts.logSilent !== false) {
      process.emitWarning &&
        process.emitWarning(
          `[dbSafe.tryConnectOnce:${label}] skipped redundant client.connect() call (client already connected).`,
        );
    }
    return { connected: false, alreadyConnected: true };
  }
  try {
    await client.connect();
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    // pg actually swallows some races and throws here with "already connected".
    // If we got that specific error, treat as success (client IS connected).
    if (
      typeof msg === 'string' &&
      (msg.toUpperCase().includes('CLIENT HAS ALREADY BEEN CONNECTED') ||
        msg.toUpperCase().includes('CANNOT REUSE A CLIENT'))
    ) {
      return { connected: false, alreadyConnected: true, supressedError: err };
    }
    throw err;
  }
  return { connected: true, alreadyConnected: false };
}

/**
 * Release a PoolClient EXACTLY ONCE (prevents double-release corruption).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
function tryReleaseOnce(client, opts = {}) {
  const label = opts.label || 'acquire';
  if (!client) return { released: false, alreadyReleased: true, reason: 'no_client' };
  if (typeof client.release !== 'function') {
    return { released: false, alreadyReleased: false, reason: 'no_release_method' };
  }
  // Tag the client so we never call release() twice on the same instance (bug guard).
  if (client.__dbsafe_released === true) {
    return { released: false, alreadyReleased: true, reason: 'already_released' };
  }
  try {
    client.__dbsafe_released = true;
    // DO NOT EVER call client.end() on a PoolClient — that destroys the pool's socket
    // and causes "Cannot reuse a client" / connection churn.
    client.release(opts.error || false);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (msg && /already been released|cannot release/i.test(msg)) {
      return { released: false, alreadyReleased: true, reason: 'pool_says_released' };
    }
    // Swallow release errors — the pool owns the socket lifecycle.
    return { released: false, alreadyReleased: false, reason: 'error', error: err };
  }
  return { released: true, alreadyReleased: false, reason: 'ok' };
}

/**
 * SAFE client acquisition from a pg Pool.
 *
 * RULE THAT WE ENFORCE: pool.connect() returns an **already-connected** PoolClient.
 * You MUST NOT call .connect() on the returned object — this helper NEVER does.
 *
 * Returned tuple: { client, release } — call release() in a finally block to
 * return the client to the pool exactly once.
 */
async function getClientFromPool(pool, opts = {}) {
  const label = opts.label || 'pool';
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error(
      `[dbSafe.getClientFromPool:${label}] first argument must be a pg Pool (has pool.connect)`,
    );
  }
  // pool.connect() returns an ALREADY-CONNECTED PoolClient. Calling .connect()
  // here would throw "Client has already been connected. You cannot reuse a client."
  // — so we DO NOT do that, ever.
  const client = await pool.connect();
  client.__dbsafe_label = label;
  client.__dbsafe_released = false;

  const release = (releaseOpts) => tryReleaseOnce(client, { label, ...releaseOpts });

  return { client, release };
}

/**
 * SAFE single-shot transaction wrapper: BEGIN → fn(client) → COMMIT / ROLLBACK → release.
 *
 * Guarantees:
 *   - Client is acquired via getClientFromPool (NEVER .connect() on PoolClient)
 *   - If fn() throws, transaction is rolled back
 *   - release() is called EXACTLY ONCE (tryReleaseOnce guard)
 *   - Errors are re-thrown for the caller to log / convert to HTTP 500
 */
async function runTransaction(pool, fn, opts = {}) {
  if (typeof fn !== 'function') {
    throw new Error('[dbSafe.runTransaction] fn must be a function(client)');
  }
  const label = opts.label || 'tx';
  const { client, release } = await getClientFromPool(pool, { label });
  let txnErr = null;
  let rollbackErr = null;
  let commitErr = null;
  let commitSuccess = false;
  let result = undefined;
  try {
    await client.query('BEGIN');
    result = await fn(client);
    try {
      await client.query('COMMIT');
      commitSuccess = true;
    } catch (err) {
      commitErr = err;
    }
    if (!commitSuccess) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        rollbackErr = rbErr;
      }
    }
  } catch (err) {
    txnErr = err;
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      rollbackErr = rbErr;
    }
  } finally {
    const releaseInfo = release({ error: Boolean(txnErr || commitErr || rollbackErr) });
    if (!txnErr && !commitErr && rollbackErr) {
      // ROLLBACK threw but commit also didn't happen — unusual, emit warning
      process.emitWarning &&
        process.emitWarning(
          `[dbSafe.runTransaction:${label}] rollback error during cleanup (release=${releaseInfo.reason}): ${rollbackErr.message || rollbackErr}`,
        );
    }
  }
  if (txnErr) throw txnErr;
  if (commitErr) throw commitErr;
  return result;
}

/**
 * SAFE transaction WITH RETRY on transient PostgreSQL errors.
 *
 * Applies exponential backoff with jitter (capped 3s) and passes the client to fn()
 * in the same safety guarantees as runTransaction (no double .connect(), release once).
 */
async function withTransaction(pool, optionsOrFn, maybeFn) {
  const opts = typeof optionsOrFn === 'function' ? {} : optionsOrFn || {};
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
  if (typeof fn !== 'function') {
    throw new Error('[dbSafe.withTransaction] callback fn is required');
  }
  const maxAttempts = Number.isFinite(opts.maxAttempts) && opts.maxAttempts >= 1 ? opts.maxAttempts : 5;
  const initialBackoffMs =
    Number.isFinite(opts.initialBackoffMs) && opts.initialBackoffMs > 0 ? opts.initialBackoffMs : 75;
  const label = opts.label || 'txRetry';

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runTransaction(pool, fn, { label: `${label}:attempt#${attempt}` });
    } catch (err) {
      lastErr = err;
      if (!isTransientPgError(err) || attempt >= maxAttempts) {
        throw err;
      }
      const backoff = Math.min(
        3000,
        initialBackoffMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 50),
      );
      const safeInfo = {
        attempt,
        maxAttempts,
        backoffMs: backoff,
        code: err && err.code,
        sqlstate: err && (err.sqlState || err.sqlstate),
        message: err && err.message,
      };
      process.emitWarning &&
        process.emitWarning(
          `[dbSafe.withTransaction:${label}] transient failure, retrying — ${JSON.stringify(safeInfo)}`,
        );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastErr;
}

module.exports = {
  isTransientPgError,
  tryConnectOnce,
  tryReleaseOnce,
  getClientFromPool,
  runTransaction,
  withTransaction,
};
