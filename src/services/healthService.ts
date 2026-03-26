import { KuboClient } from '../clients/kuboClient.js';
import { PinRepository } from '../repositories/pinRepository.js';
import { WorkerRuntime } from '../workers/runtime.js';

export class HealthService {
  constructor(
    private readonly repository: PinRepository,
    private readonly kuboClient: KuboClient,
    private readonly workerRuntime: WorkerRuntime
  ) {}

  getLiveness() {
    return { ok: true };
  }

  async getReadiness() {
    const checks = {
      database: false,
      kuboApi: false,
      worker: this.workerRuntime.isRunning()
    };

    try {
      this.repository.ping();
      checks.database = true;
    } catch {
      checks.database = false;
    }

    try {
      await this.kuboClient.getRepoStat();
      checks.kuboApi = true;
    } catch {
      checks.kuboApi = false;
    }

    const ok = checks.database && checks.kuboApi && checks.worker;
    return { ok, checks };
  }
}
