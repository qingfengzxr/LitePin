import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { CreatePinRequestInput, PinRequestRecord, PinStatus } from '../domain/pinRequest.js';

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

const createRequestId = () => `pin-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

export class PinRepository {
  private readonly db: Database.Database;
  private readonly insertStmt;
  private readonly resetFailedStmt;
  private readonly getByIdStmt;
  private readonly getByCidStmt;
  private readonly getNextRunnableStmt;
  private readonly markPinningStmt;
  private readonly markPinnedStmt;
  private readonly markProvideAttemptStmt;
  private readonly markRetryStmt;
  private readonly markFailedStmt;
  private readonly countPinnedStmt;
  private readonly queueSummaryStmt;
  private readonly claimNextRunnableTxn;
  readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(`
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

    const columns = this.db.prepare(`PRAGMA table_info(pin_requests)`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'error_code')) {
      this.db.exec(`ALTER TABLE pin_requests ADD COLUMN error_code TEXT`);
    }
    if (!columns.some((column) => column.name === 'attempts')) {
      this.db.exec(`ALTER TABLE pin_requests ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columns.some((column) => column.name === 'next_retry_at')) {
      this.db.exec(`ALTER TABLE pin_requests ADD COLUMN next_retry_at TEXT`);
    }
    if (!columns.some((column) => column.name === 'last_polled_at')) {
      this.db.exec(`ALTER TABLE pin_requests ADD COLUMN last_polled_at TEXT`);
    }
    if (!columns.some((column) => column.name === 'provide_attempts')) {
      this.db.exec(`ALTER TABLE pin_requests ADD COLUMN provide_attempts INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columns.some((column) => column.name === 'provided_at')) {
      this.db.exec(`ALTER TABLE pin_requests ADD COLUMN provided_at TEXT`);
    }

    this.insertStmt = this.db.prepare(`
      INSERT INTO pin_requests (
        id, cid, source, address, storage_type, status, error, error_code, attempts, next_retry_at, last_polled_at,
        created_at, updated_at, started_at, completed_at, provide_attempts, provided_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?, NULL, NULL, 0, NULL)
    `);
    this.resetFailedStmt = this.db.prepare(`
      UPDATE pin_requests
      SET status = 'queued',
          error = NULL,
          error_code = NULL,
          next_retry_at = NULL,
          updated_at = ?
      WHERE id = ?
    `);
    this.getByIdStmt = this.db.prepare(`
      SELECT id, cid, source, address, storage_type, status, error, error_code, attempts, next_retry_at, last_polled_at,
             created_at, updated_at, started_at, completed_at, provide_attempts, provided_at
      FROM pin_requests
      WHERE id = ?
    `);
    this.getByCidStmt = this.db.prepare(`
      SELECT id, cid, source, address, storage_type, status, error, error_code, attempts, next_retry_at, last_polled_at,
             created_at, updated_at, started_at, completed_at, provide_attempts, provided_at
      FROM pin_requests
      WHERE cid = ?
    `);
    this.getNextRunnableStmt = this.db.prepare(`
      SELECT id, cid, source, address, storage_type, status, error, error_code, attempts, next_retry_at, last_polled_at,
             created_at, updated_at, started_at, completed_at, provide_attempts, provided_at
      FROM pin_requests
      WHERE (status = 'queued' AND (next_retry_at IS NULL OR next_retry_at <= ?))
         OR (status = 'pinning' AND updated_at <= ?)
      ORDER BY CASE status WHEN 'pinning' THEN 0 ELSE 1 END, updated_at ASC
      LIMIT 1
    `);
    this.markPinningStmt = this.db.prepare(`
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
    this.markPinnedStmt = this.db.prepare(`
      UPDATE pin_requests
      SET status = 'pinned',
          error = NULL,
          error_code = NULL,
          next_retry_at = NULL,
          last_polled_at = ?,
          completed_at = COALESCE(completed_at, ?),
          provided_at = COALESCE(?, provided_at),
          updated_at = ?
      WHERE id = ?
    `);
    this.markProvideAttemptStmt = this.db.prepare(`
      UPDATE pin_requests
      SET provide_attempts = provide_attempts + 1,
          last_polled_at = ?,
          updated_at = ?
      WHERE id = ?
    `);
    this.markRetryStmt = this.db.prepare(`
      UPDATE pin_requests
      SET status = 'queued',
          error = ?,
          error_code = ?,
          next_retry_at = ?,
          last_polled_at = ?,
          updated_at = ?
      WHERE id = ?
    `);
    this.markFailedStmt = this.db.prepare(`
      UPDATE pin_requests
      SET status = 'failed',
          error = ?,
          error_code = ?,
          next_retry_at = NULL,
          last_polled_at = ?,
          updated_at = ?
      WHERE id = ?
    `);
    this.countPinnedStmt = this.db.prepare(`SELECT count(*) as count FROM pin_requests WHERE status = 'pinned'`);
    this.queueSummaryStmt = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'pinning' THEN 1 ELSE 0 END) as pinning,
        SUM(CASE WHEN status = 'pinned' THEN 1 ELSE 0 END) as pinned,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        COUNT(*) as total,
        MIN(CASE WHEN status = 'queued' THEN created_at END) as oldest_queued_at,
        MIN(CASE WHEN status = 'pinning' THEN started_at END) as oldest_pinning_at,
        MAX(CASE WHEN status = 'pinned' THEN completed_at END) as latest_completed_at,
        MAX(CASE WHEN status = 'failed' THEN updated_at END) as latest_failed_at,
        MIN(CASE WHEN status = 'queued' AND next_retry_at IS NOT NULL THEN next_retry_at END) as next_retry_at
      FROM pin_requests
    `);
    this.claimNextRunnableTxn = this.db.transaction((staleBefore: string) => {
      const now = new Date().toISOString();
      const row = this.getNextRunnableStmt.get(now, staleBefore) as PinRequestRow | undefined;
      if (!row) {
        return null;
      }
      this.markPinningStmt.run(now, now, now, row.id);
      const claimed = this.getByIdStmt.get(row.id) as PinRequestRow | undefined;
      return claimed ? toRecord(claimed) : null;
    });
  }

  ping() {
    this.db.prepare('SELECT 1').get();
  }

  close() {
    this.db.close();
  }

  createOrReuse(input: CreatePinRequestInput): PinRequestRecord {
    const existing = this.getByCidStmt.get(input.cid) as PinRequestRow | undefined;
    if (existing) {
      if (existing.status === 'failed') {
        const now = new Date().toISOString();
        this.resetFailedStmt.run(now, existing.id);
        return this.getById(existing.id)!;
      }
      return toRecord(existing);
    }
    const now = new Date().toISOString();
    const id = createRequestId();
    this.insertStmt.run(id, input.cid, input.source || null, input.address || null, input.storageType || null, 'queued', now, now);
    return this.getById(id)!;
  }

  getById(id: string): PinRequestRecord | null {
    const row = this.getByIdStmt.get(id) as PinRequestRow | undefined;
    return row ? toRecord(row) : null;
  }

  getByCid(cid: string): PinRequestRecord | null {
    const row = this.getByCidStmt.get(cid) as PinRequestRow | undefined;
    return row ? toRecord(row) : null;
  }

  claimNextRunnable(staleBefore: string): PinRequestRecord | null {
    return this.claimNextRunnableTxn(staleBefore) as PinRequestRecord | null;
  }

  markProvideAttempt(id: string) {
    const now = new Date().toISOString();
    this.markProvideAttemptStmt.run(now, now, id);
  }

  markPinned(id: string, providedAt?: string | null) {
    const now = new Date().toISOString();
    this.markPinnedStmt.run(now, now, providedAt ?? null, now, id);
  }

  markRetry(id: string, error: string, errorCode: string, nextRetryAt: string) {
    const now = new Date().toISOString();
    this.markRetryStmt.run(error, errorCode, nextRetryAt, now, now, id);
  }

  markFailed(id: string, error: string, errorCode: string) {
    const now = new Date().toISOString();
    this.markFailedStmt.run(error, errorCode, now, now, id);
  }

  getPinnedCount() {
    const row = this.countPinnedStmt.get() as { count: number };
    return row.count;
  }

  getQueueSummary() {
    const row = this.queueSummaryStmt.get() as {
      queued: number | null;
      pinning: number | null;
      pinned: number | null;
      failed: number | null;
      total: number | null;
      oldest_queued_at: string | null;
      oldest_pinning_at: string | null;
      latest_completed_at: string | null;
      latest_failed_at: string | null;
      next_retry_at: string | null;
    };
    return {
      queued: row.queued || 0,
      pinning: row.pinning || 0,
      pinned: row.pinned || 0,
      failed: row.failed || 0,
      total: row.total || 0,
      oldestQueuedAt: row.oldest_queued_at,
      oldestPinningAt: row.oldest_pinning_at,
      latestCompletedAt: row.latest_completed_at,
      latestFailedAt: row.latest_failed_at,
      nextRetryAt: row.next_retry_at
    };
  }
}
