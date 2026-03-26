import type { CreatePinRequestInput } from '../domain/pinRequest.js';
import { notFound } from '../domain/errors.js';
import { PinRepository } from '../repositories/pinRepository.js';
import { KuboClient } from '../clients/kuboClient.js';
import { LitePinMetrics } from '../infra/metrics.js';

export class PinService {
  constructor(
    private readonly repository: PinRepository,
    private readonly kuboClient: KuboClient,
    private readonly maxRepoUsageRatio: number,
    private readonly metrics: LitePinMetrics
  ) {}

  createOrReuseWithMeta(input: CreatePinRequestInput) {
    const existing = this.repository.getByCid(input.cid);
    const record = this.repository.createOrReuse(input);
    this.metrics.recordPinRequestAccepted(Boolean(existing));
    return { record, reused: Boolean(existing) };
  }

  getById(requestId: string) {
    const record = this.repository.getById(requestId);
    if (!record) {
      throw notFound('Pin request not found');
    }
    return record;
  }

  async getStats() {
    const repo = await this.kuboClient.getRepoStat();
    const acceptingNewPins =
      !repo.storageMaxBytes || repo.storageMaxBytes <= 0
        ? true
        : repo.repoSizeBytes / repo.storageMaxBytes < this.maxRepoUsageRatio;
    return {
      storageMaxBytes: repo.storageMaxBytes,
      repoSizeBytes: repo.repoSizeBytes,
      pinnedCount: this.repository.getPinnedCount(),
      acceptingNewPins
    };
  }
}
