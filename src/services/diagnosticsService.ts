import type { AppConfig } from '../infra/config.js';
import { KuboClient } from '../clients/kuboClient.js';
import { LitePinMetrics } from '../infra/metrics.js';
import { PinRepository } from '../repositories/pinRepository.js';
import { WorkerRuntime } from '../workers/runtime.js';

export class DiagnosticsService {
  constructor(
    private readonly repository: PinRepository,
    private readonly kuboClient: KuboClient,
    private readonly workerRuntime: WorkerRuntime,
    private readonly metrics: LitePinMetrics,
    private readonly config: AppConfig
  ) {}

  getWorkerDiagnostics() {
    const snapshot = this.workerRuntime.getSnapshot();
    return {
      running: snapshot.running,
      stopping: snapshot.stopping,
      activeWorkers: snapshot.activeWorkers,
      configuredConcurrency: this.config.workerConcurrency,
      pollIntervalMs: this.config.workerPollMs,
      idleLogIntervalMs: this.config.workerIdleLogMs,
      lastIdleLogAt: snapshot.lastIdleLogAt,
      provideAfterPin: this.config.provideAfterPin
    };
  }

  getQueueDiagnostics() {
    const summary = this.repository.getQueueSummary();
    return {
      counts: {
        queued: summary.queued,
        pinning: summary.pinning,
        pinned: summary.pinned,
        failed: summary.failed,
        total: summary.total
      },
      oldestQueuedAt: summary.oldestQueuedAt,
      oldestPinningAt: summary.oldestPinningAt,
      latestCompletedAt: summary.latestCompletedAt,
      latestFailedAt: summary.latestFailedAt,
      nextRetryAt: summary.nextRetryAt
    };
  }

  async getDependenciesDiagnostics() {
    let databaseOk = true;
    let kuboOk = false;
    let repoSizeBytes: number | null = null;
    let storageMaxBytes: number | null = null;
    let kuboError: string | null = null;

    try {
      this.repository.ping();
    } catch {
      databaseOk = false;
    }

    try {
      const repo = await this.kuboClient.getRepoStat();
      kuboOk = true;
      repoSizeBytes = repo.repoSizeBytes;
      storageMaxBytes = repo.storageMaxBytes;
    } catch (err: any) {
      kuboError = err?.message || 'Unknown Kubo error';
    }

    return {
      database: {
        ok: databaseOk,
        path: this.repository.dbPath
      },
      kuboApi: {
        ok: kuboOk,
        url: this.config.kuboApiUrl,
        repoSizeBytes,
        storageMaxBytes,
        error: kuboError
      },
      gateway: {
        url: this.kuboClient.getGatewayBaseUrl()
      }
    };
  }

  async renderMetrics() {
    let repoSizeBytes: number | null = null;
    let storageMaxBytes: number | null = null;
    try {
      const repo = await this.kuboClient.getRepoStat();
      repoSizeBytes = repo.repoSizeBytes;
      storageMaxBytes = repo.storageMaxBytes;
    } catch {
      repoSizeBytes = null;
      storageMaxBytes = null;
    }

    const queue = this.repository.getQueueSummary();
    const worker = this.workerRuntime.getSnapshot();
    return this.metrics.renderPrometheus({
      queueCounts: {
        queued: queue.queued,
        pinning: queue.pinning,
        pinned: queue.pinned,
        failed: queue.failed,
        total: queue.total
      },
      worker,
      repo: { repoSizeBytes, storageMaxBytes }
    });
  }
}
