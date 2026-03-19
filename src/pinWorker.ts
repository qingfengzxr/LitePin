import logger from './logger.js';
import {
  claimNextRunnablePinRequest,
  type PinRequestRecord,
  markPinRequestFailed,
  markPinRequestPinned,
  markPinRequestRetry
} from './pinStore.js';
import { getKuboRepoStat, isPinnedInKubo, pinCidInKubo } from './kuboClient.js';

const POLL_INTERVAL_MS = Number(process.env.PIN_WORKER_POLL_MS || 5_000);
const CONCURRENCY = Math.max(1, Number(process.env.PIN_WORKER_CONCURRENCY || 1));
const MAX_RETRIES = Number(process.env.PIN_MAX_RETRIES || 3);
const BASE_RETRY_DELAY_MS = Number(process.env.PIN_BASE_RETRY_MS || 15_000);
const RUNNING_STALE_MS = Number(process.env.PIN_RUNNING_STALE_MS || 60 * 60 * 1000);
export const MAX_REPO_USAGE_RATIO = Number(process.env.PIN_MAX_REPO_USAGE_RATIO || 0.9);

const computeNextRetryAt = (attempts: number) => {
  const delay = Math.min(30 * 60 * 1000, BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attempts - 1)));
  return new Date(Date.now() + delay).toISOString();
};

const classifyError = (err: any): { code: string; retriable: boolean; message: string } => {
  const message = err?.message || 'pin request failed';
  const normalized = String(message).toLowerCase();
  if (normalized.includes('timed out')) {
    return { code: 'timeout', retriable: true, message };
  }
  if (normalized.includes('connection refused') || normalized.includes('fetch failed') || normalized.includes('econnrefused')) {
    return { code: 'kubo_unreachable', retriable: true, message };
  }
  if (normalized.includes('capacity_exceeded')) {
    return { code: 'capacity_exceeded', retriable: true, message };
  }
  if (normalized.includes('not found') || normalized.includes('merkledag') || normalized.includes('blockservice')) {
    return { code: 'cid_unavailable', retriable: true, message };
  }
  return { code: 'pin_failed', retriable: false, message };
};

const assertRepoHasCapacity = async () => {
  const repo = await getKuboRepoStat();
  if (!repo.storageMaxBytes || repo.storageMaxBytes <= 0) {
    return repo;
  }
  if (repo.repoSizeBytes / repo.storageMaxBytes >= MAX_REPO_USAGE_RATIO) {
    throw new Error(
      `capacity_exceeded repoSize=${repo.repoSizeBytes} storageMax=${repo.storageMaxBytes} usageRatio=${(
        repo.repoSizeBytes / repo.storageMaxBytes
      ).toFixed(4)}`
    );
  }
  return repo;
};

const scheduleFailureOrRetry = (job: PinRequestRecord, err: any) => {
  const { code, retriable, message } = classifyError(err);
  if (retriable && job.attempts < MAX_RETRIES) {
    const nextRetryAt = computeNextRetryAt(job.attempts);
    markPinRequestRetry(job.id, message, code, nextRetryAt);
    logger.warn({ requestId: job.id, cid: job.cid, errorCode: code, nextRetryAt }, '[pin-worker] scheduled retry');
    return;
  }
  markPinRequestFailed(job.id, message, code);
  logger.error({ requestId: job.id, cid: job.cid, errorCode: code }, '[pin-worker] pin request marked failed');
};

export class PinWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeWorkers = 0;

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.pump();
    }, POLL_INTERVAL_MS);
    this.pump();
    logger.info({ pollMs: POLL_INTERVAL_MS, concurrency: CONCURRENCY }, '[pin-worker] started');
  }

  private pump() {
    while (this.activeWorkers < CONCURRENCY) {
      this.activeWorkers += 1;
      void this.processOne().finally(() => {
        this.activeWorkers -= 1;
      });
    }
  }

  private async processOne() {
    let activeJob: PinRequestRecord | null = null;
    try {
      const staleBefore = new Date(Date.now() - RUNNING_STALE_MS).toISOString();
      const job = claimNextRunnablePinRequest(staleBefore);
      if (!job) {
        return;
      }
      activeJob = job;
      logger.info({ requestId: job.id, cid: job.cid, attempts: job.attempts }, '[pin-worker] processing pin request');
      const alreadyPinned = await isPinnedInKubo(job.cid);
      if (!alreadyPinned) {
        await assertRepoHasCapacity();
        await pinCidInKubo(job.cid);
      }
      markPinRequestPinned(job.id);
      logger.info({ requestId: job.id, cid: job.cid }, '[pin-worker] pin request completed');
    } catch (err: any) {
      if (activeJob) {
        scheduleFailureOrRetry(
          {
            ...activeJob,
            attempts: activeJob.attempts + 1
          },
          err
        );
      }
      logger.error({ err }, '[pin-worker] pin request failed');
    }
  }
}
