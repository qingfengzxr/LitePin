import logger from '../infra/logger.js';
import { PinRepository } from '../repositories/pinRepository.js';
import { KuboClient } from '../clients/kuboClient.js';
import type { PinRequestRecord } from '../domain/pinRequest.js';
import type { AppConfig } from '../infra/config.js';
import { LitePinMetrics } from '../infra/metrics.js';

const computeNextRetryAt = (attempts: number, baseRetryMs: number) => {
  const delay = Math.min(30 * 60 * 1000, baseRetryMs * Math.pow(2, Math.max(0, attempts - 1)));
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
  if (normalized.includes('provide') || normalized.includes('routing')) {
    return { code: 'provide_failed', retriable: true, message };
  }
  return { code: 'pin_failed', retriable: false, message };
};

export class PinWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeWorkers = 0;
  private stopping = false;
  private lastIdleLogAt = 0;

  constructor(
    private readonly repository: PinRepository,
    private readonly kuboClient: KuboClient,
    private readonly config: AppConfig,
    private readonly metrics: LitePinMetrics
  ) {}

  start() {
    if (this.timer) {
      return;
    }
    this.stopping = false;
    this.timer = setInterval(() => {
      this.pump();
    }, this.config.workerPollMs);
    this.pump();
    logger.info(
      {
        pollMs: this.config.workerPollMs,
        concurrency: this.config.workerConcurrency,
        idleLogMs: this.config.workerIdleLogMs,
        provideAfterPin: this.config.provideAfterPin
      },
      '[pin-worker] started'
    );
  }

  async stop(graceMs = this.config.shutdownGraceMs) {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const deadline = Date.now() + graceMs;
    while (this.activeWorkers > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    logger.info({ activeWorkers: this.activeWorkers }, '[pin-worker] stopped');
  }

  isRunning() {
    return this.timer !== null && !this.stopping;
  }

  getSnapshot() {
    return {
      running: this.isRunning(),
      stopping: this.stopping,
      activeWorkers: this.activeWorkers,
      lastIdleLogAt: this.lastIdleLogAt === 0 ? null : new Date(this.lastIdleLogAt).toISOString()
    };
  }

  private pump() {
    if (this.stopping) {
      return;
    }
    while (this.activeWorkers < this.config.workerConcurrency) {
      this.activeWorkers += 1;
      void this.processOne()
        .then((claimedJob) => {
          this.activeWorkers -= 1;
          if (!this.stopping && claimedJob) {
            this.pump();
          }
        })
        .catch(() => {
          this.activeWorkers -= 1;
          if (!this.stopping) {
            this.pump();
          }
        });
    }
  }

  private async processOne(): Promise<boolean> {
    let activeJob: PinRequestRecord | null = null;
    try {
      const staleBefore = new Date(Date.now() - this.config.runningStaleMs).toISOString();
      const job = this.repository.claimNextRunnable(staleBefore);
      if (!job) {
        this.logIdle();
        return false;
      }
      this.lastIdleLogAt = 0;
      activeJob = job;
      logger.info(
        { requestId: job.id, cid: job.cid, attempts: job.attempts, concurrency: this.config.workerConcurrency },
        '[pin-worker] processing pin request'
      );
      const alreadyPinned = await this.kuboClient.isPinned(job.cid);
      if (!alreadyPinned) {
        await this.assertRepoHasCapacity();
        await this.kuboClient.pinCid(job.cid);
      }

      this.repository.markPinned(job.id, null);

      let providedAt: string | null = null;
      let provideAttempts = job.provideAttempts;
      if (this.config.provideAfterPin) {
        try {
          this.repository.markProvideAttempt(job.id);
          provideAttempts += 1;
          await this.kuboClient.provideCid(job.cid);
          providedAt = new Date().toISOString();
          this.repository.markPinned(job.id, providedAt);
        } catch (err: any) {
          this.metrics.recordWorkerProvideFailure();
          logger.warn(
            { err, requestId: job.id, cid: job.cid, provideAttempts },
            '[pin-worker] provide failed after pin; request remains pinned'
          );
        }
      }

      this.metrics.recordWorkerJobCompleted();
      logger.info(
        { requestId: job.id, cid: job.cid, alreadyPinned, provided: this.config.provideAfterPin, providedAt, provideAttempts },
        '[pin-worker] pin request completed'
      );
      return true;
    } catch (err: any) {
      if (activeJob) {
        this.scheduleFailureOrRetry(
          {
            ...activeJob,
            attempts: activeJob.attempts + 1
          },
          err
        );
      }
      logger.error(
        { err, requestId: activeJob?.id, cid: activeJob?.cid, attempts: activeJob?.attempts != null ? activeJob.attempts + 1 : undefined },
        '[pin-worker] pin request failed'
      );
      return activeJob !== null;
    }
  }

  private async assertRepoHasCapacity() {
    const repo = await this.kuboClient.getRepoStat();
    if (!repo.storageMaxBytes || repo.storageMaxBytes <= 0) {
      return;
    }
    if (repo.repoSizeBytes / repo.storageMaxBytes >= this.config.maxRepoUsageRatio) {
      throw new Error(
        `capacity_exceeded repoSize=${repo.repoSizeBytes} storageMax=${repo.storageMaxBytes} usageRatio=${(
          repo.repoSizeBytes / repo.storageMaxBytes
        ).toFixed(4)}`
      );
    }
  }

  private scheduleFailureOrRetry(job: PinRequestRecord, err: any) {
    const { code, retriable, message } = classifyError(err);
    if (retriable && job.attempts < this.config.maxRetries) {
      const nextRetryAt = computeNextRetryAt(job.attempts, this.config.baseRetryMs);
      this.repository.markRetry(job.id, message, code, nextRetryAt);
      this.metrics.recordWorkerJobRetried();
      logger.warn(
        { requestId: job.id, cid: job.cid, attempts: job.attempts, errorCode: code, nextRetryAt, message },
        '[pin-worker] scheduled retry'
      );
      return;
    }
    this.repository.markFailed(job.id, message, code);
    this.metrics.recordWorkerJobFailed();
    logger.error(
      { requestId: job.id, cid: job.cid, attempts: job.attempts, errorCode: code, message },
      '[pin-worker] pin request marked failed'
    );
  }

  private logIdle() {
    const now = Date.now();
    if (this.lastIdleLogAt !== 0 && now - this.lastIdleLogAt < this.config.workerIdleLogMs) {
      return;
    }
    this.lastIdleLogAt = now;
    logger.info({ idleLogMs: this.config.workerIdleLogMs }, '[pin-worker] no pin requests ready');
  }
}
