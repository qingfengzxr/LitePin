import { Readable } from 'stream';
import type { AppConfig } from '../infra/config.js';
import type { RepoStats } from '../domain/pinRequest.js';

type RepoStat = {
  RepoSize?: number;
  StorageMax?: number | string;
};

const parseStorageMax = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export class KuboClient {
  constructor(private readonly config: AppConfig) {}

  private async kuboPost<T>(path: string, params?: URLSearchParams): Promise<T> {
    const suffix = params?.toString() ? `?${params.toString()}` : '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.kuboRequestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.config.kuboApiUrl}${path}${suffix}`, { method: 'POST', signal: controller.signal });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Kubo request timed out after ${this.config.kuboRequestTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Kubo request failed (${response.status}): ${text}`);
    }
    const text = await response.text();
    if (!text.trim()) {
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (err: any) {
      throw new Error(`Kubo request returned invalid JSON: ${err?.message || 'parse failed'}`);
    }
  }

  async isPinned(cid: string): Promise<boolean> {
    try {
      const body =
        (await this.kuboPost<{ Keys?: Record<string, unknown> }>('/api/v0/pin/ls', new URLSearchParams({ arg: cid }))) || {};
      return Boolean(body.Keys && Object.keys(body.Keys).length > 0);
    } catch (err: any) {
      if (String(err?.message || '').includes('not pinned')) {
        return false;
      }
      throw err;
    }
  }

  async pinCid(cid: string): Promise<void> {
    await this.kuboPost('/api/v0/pin/add', new URLSearchParams({ arg: cid, recursive: 'true', progress: 'false' }));
  }

  async provideCid(cid: string): Promise<void> {
    await this.kuboPost('/api/v0/routing/provide', new URLSearchParams({ arg: cid, recursive: 'true' }));
  }

  async getRepoStat(): Promise<RepoStats> {
    const body = await this.kuboPost<RepoStat>('/api/v0/repo/stat', new URLSearchParams({ size_only: 'false' }));
    return {
      repoSizeBytes: typeof body.RepoSize === 'number' ? body.RepoSize : 0,
      storageMaxBytes: parseStorageMax(body.StorageMax)
    };
  }

  async headCid(cid: string) {
    return this.kuboGatewayFetch(cid, 'HEAD');
  }

  async getCid(cid: string) {
    return this.kuboGatewayFetch(cid, 'GET');
  }

  getGatewayReadableStream(response: Response) {
    if (!response.body) {
      return null;
    }
    return Readable.fromWeb(response.body as any);
  }

  getGatewayBaseUrl() {
    return this.config.kuboGatewayUrl;
  }

  private async kuboGatewayFetch(cid: string, method: 'GET' | 'HEAD') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.kuboRequestTimeoutMs);
    try {
      return await fetch(`${this.config.kuboGatewayUrl}/ipfs/${encodeURIComponent(cid)}`, { method, signal: controller.signal });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Kubo gateway request timed out after ${this.config.kuboRequestTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
