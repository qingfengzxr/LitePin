import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { resolveDataPath } from './storagePaths.js';

export type PinStatus = 'queued' | 'pinning' | 'pinned' | 'failed';

export type PinRequestRecord = {
  id: string;
  cid: string;
  source: string | null;
  address: string | null;
  storageType: string | null;
  status: PinStatus;
  error: string | null;
  errorCode: string | null;
  attempts: number;
  nextRetryAt: string | null;
  lastPolledAt: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  provideAttempts: number;
  providedAt: string | null;
};

type PinRequestRow = {
  id: string;
  cid: string;
  source: string | null;
  address: string | null;
  storage_type: string | null;
  status: PinStatus;
  error: string | null;
  error_code: string | null;
  attempts: number;
  next_retry_at: string | null;
  last_polled_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  provide_attempts: number;
  provided_at: string | null;
};

const defaultDbPath = resolveDataPath('pin-service.sqlite');
const dbPath = process.env.PIN_DB_PATH || defaultDbPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS pin_requests (
    id TEXT PRIMARY KEY,
    cid TEXT NOT NULL UNIQUE,
    source TEXT,
    address TEXT,
    storage_type TEXT,
    status TEXT NOT NULL,
    error TEXT,
    error_code TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    last_polled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    provide_attempts INTEGER NOT NULL DEFAULT 0,
    provided_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pin_requests_status_updated_at
  ON pin_requests(status, updated_at);
`);

const pinRequestColumns = db.prepare(`PRAGMA table_info(pin_requests)`).all() as Array<{ name: string }>;
if (!pinRequestColumns.some((column) => column.name === 'error_code')) {
  db.exec(`ALTER TABLE pin_requests ADD COLUMN error_code TEXT`);
}
if (!pinRequestColumns.some((column) => column.name === 'attempts')) {
  db.exec(`ALTER TABLE pin_requests ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`);
}
if (!pinRequestColumns.some((column) => column.name === 'next_retry_at')) {
  db.exec(`ALTER TABLE pin_requests ADD COLUMN next_retry_at TEXT`);
}
if (!pinRequestColumns.some((column) => column.name === 'last_polled_at')) {
  db.exec(`ALTER TABLE pin_requests ADD COLUMN last_polled_at TEXT`);
}
if (!pinRequestColumns.some((column) => column.name === 'provide_attempts')) {
  db.exec(`ALTER TABLE pin_requests ADD COLUMN provide_attempts INTEGER NOT NULL DEFAULT 0`);
}
if (!pinRequestColumns.some((column) => column.name === 'provided_at')) {
  db.exec(`ALTER TABLE pin_requests ADD COLUMN provided_at TEXT`);
}

const toRecord = (row: PinRequestRow): PinRequestRecord => ({
  id: row.id,
  cid: row.cid,
  source: row.source,
  address: row.address,
  storageType: row.storage_type,
  status: row.status,
  error: row.error,
  errorCode: row.error_code,
  attempts: row.attempts,
  nextRetryAt: row.next_retry_at,
  lastPolledAt: row.last_polled_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  provideAttempts: row.provide_attempts,
  providedAt: row.provided_at
});

const insertStmt = db.prepare(`
  INSERT INTO pin_requests (
    id, cid, source, address, storage_type, status, error, error_code, attempts, next_retry_at, last_polled_at,
    created_at, updated_at, started_at, completed_at, provide_attempts, provided_at
  ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?, NULL, NULL, 0, NULL)
`);

const resetFailedStmt = db.prepare(`
  UPDATE pin_requests
  SET status = 'queued',
      error = NULL,
      error_code = NULL,
      next_retry_at = NULL,
      updated_at = ?
  WHERE id = ?
`);

const getByIdStmt = db.prepare(`
  SELECT id, cid, source, address, storage_type, status, error, error_code, attempts, next_retry_at, last_polled_at,
         created_at, updated_at, started_at, completed_at, provide_attempts, provided_at
  FROM pin_requests
  WHERE id = ?
`);

const getByCidStmt = db.prepare(`
  SELECT id, cid, source, address, storage_type, status, error, error_code, attempts, next_retry_at, last_polled_at,
         created_at, updated_at, started_at, completed_at, provide_attempts, provided_at
  FROM pin_requests
  WHERE cid = ?
`);

const getNextRunnableStmt = db.prepare(`
  SELECT id, cid, source, address, storage_type, status, error, error_code, attempts, next_retry_at, last_polled_at,
         created_at, updated_at, started_at, completed_at, provide_attempts, provided_at
  FROM pin_requests
  WHERE (status = 'queued' AND (next_retry_at IS NULL OR next_retry_at <= ?))
     OR (status = 'pinning' AND updated_at <= ?)
  ORDER BY CASE status WHEN 'pinning' THEN 0 ELSE 1 END, updated_at ASC
  LIMIT 1
`);

const markPinningStmt = db.prepare(`
  UPDATE pin_requests
  SET status = 'pinning',
      error = NULL,
      error_code = NULL,
      attempts = attempts + 1,
      next_retry_at = NULL,
      last_polled_at = ?,
      started_at = COALESCE(started_at, ?),
      updated_at = ?
  WHERE id = ?
`);

const markPinnedStmt = db.prepare(`
  UPDATE pin_requests
  SET status = 'pinned',
      error = NULL,
      error_code = NULL,
      next_retry_at = NULL,
      last_polled_at = ?,
      completed_at = ?,
      provided_at = ?,
      updated_at = ?
  WHERE id = ?
`);

const markProvideAttemptStmt = db.prepare(`
  UPDATE pin_requests
  SET provide_attempts = provide_attempts + 1,
      last_polled_at = ?,
      updated_at = ?
  WHERE id = ?
`);

const markRetryStmt = db.prepare(`
  UPDATE pin_requests
  SET status = 'queued',
      error = ?,
      error_code = ?,
      next_retry_at = ?,
      last_polled_at = ?,
      updated_at = ?
  WHERE id = ?
`);

const markFailedStmt = db.prepare(`
  UPDATE pin_requests
  SET status = 'failed',
      error = ?,
      error_code = ?,
      next_retry_at = NULL,
      last_polled_at = ?,
      updated_at = ?
  WHERE id = ?
`);

const countPinnedStmt = db.prepare(`SELECT count(*) as count FROM pin_requests WHERE status = 'pinned'`);

const createRequestId = () => `pin-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

export const createOrReusePinRequest = (input: {
  cid: string;
  source?: string | null;
  address?: string | null;
  storageType?: string | null;
}): PinRequestRecord => {
  const existing = getByCidStmt.get(input.cid) as PinRequestRow | undefined;
  if (existing) {
    if (existing.status === 'failed') {
      const now = new Date().toISOString();
      resetFailedStmt.run(now, existing.id);
      return getPinRequestById(existing.id)!;
    }
    return toRecord(existing);
  }
  const now = new Date().toISOString();
  const id = createRequestId();
  insertStmt.run(id, input.cid, input.source || null, input.address || null, input.storageType || null, 'queued', now, now);
  return getPinRequestById(id)!;
};

export const getPinRequestById = (id: string): PinRequestRecord | null => {
  const row = getByIdStmt.get(id) as PinRequestRow | undefined;
  return row ? toRecord(row) : null;
};

export const getPinRequestByCid = (cid: string): PinRequestRecord | null => {
  const row = getByCidStmt.get(cid) as PinRequestRow | undefined;
  return row ? toRecord(row) : null;
};

export const getNextRunnablePinRequest = (staleBefore: string): PinRequestRecord | null => {
  const now = new Date().toISOString();
  const row = getNextRunnableStmt.get(now, staleBefore) as PinRequestRow | undefined;
  return row ? toRecord(row) : null;
};

export const markPinRequestPinning = (id: string) => {
  const now = new Date().toISOString();
  markPinningStmt.run(now, now, now, id);
};

const claimNextRunnableTxn = db.transaction((staleBefore: string) => {
  const now = new Date().toISOString();
  const row = getNextRunnableStmt.get(now, staleBefore) as PinRequestRow | undefined;
  if (!row) {
    return null;
  }
  markPinningStmt.run(now, now, now, row.id);
  const claimed = getByIdStmt.get(row.id) as PinRequestRow | undefined;
  return claimed ? toRecord(claimed) : null;
});

export const claimNextRunnablePinRequest = (staleBefore: string): PinRequestRecord | null => claimNextRunnableTxn(staleBefore);

export const markPinRequestProvideAttempt = (id: string) => {
  const now = new Date().toISOString();
  markProvideAttemptStmt.run(now, now, id);
};

export const markPinRequestPinned = (id: string, providedAt?: string | null) => {
  const now = new Date().toISOString();
  markPinnedStmt.run(now, now, providedAt ?? null, now, id);
};

export const markPinRequestRetry = (id: string, error: string, errorCode: string, nextRetryAt: string) => {
  const now = new Date().toISOString();
  markRetryStmt.run(error, errorCode, nextRetryAt, now, now, id);
};

export const markPinRequestFailed = (id: string, error: string, errorCode: string) => {
  const now = new Date().toISOString();
  markFailedStmt.run(error, errorCode, now, now, id);
};

export const getPinnedCount = () => {
  const row = countPinnedStmt.get() as { count: number };
  return row.count;
};

export const getPinDbPath = () => dbPath;
