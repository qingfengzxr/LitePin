import { Readable } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';

type RepoStat = {
  RepoSize?: number;
  StorageMax?: number;
};

const getKuboApiUrl = () => (process.env.KUBO_API_URL?.trim() || 'http://127.0.0.1:5001').replace(/\/+$/, '');
const getKuboGatewayUrl = () => (process.env.KUBO_GATEWAY_URL?.trim() || 'http://127.0.0.1:8181').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.KUBO_REQUEST_TIMEOUT_MS || 30 * 60 * 1000);

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

const kuboPost = async <T>(path: string, params?: URLSearchParams): Promise<T> => {
  const suffix = params?.toString() ? `?${params.toString()}` : '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${getKuboApiUrl()}${path}${suffix}`, { method: 'POST', signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Kubo request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kubo request failed (${response.status}): ${text}`);
  }
  return (await response.json()) as T;
};

export const isPinnedInKubo = async (cid: string): Promise<boolean> => {
  try {
    const body = (await kuboPost<{ Keys?: Record<string, unknown> }>('/api/v0/pin/ls', new URLSearchParams({ arg: cid }))) || {};
    return Boolean(body.Keys && Object.keys(body.Keys).length > 0);
  } catch (err: any) {
    if (String(err?.message || '').includes('not pinned')) {
      return false;
    }
    throw err;
  }
};

export const pinCidInKubo = async (cid: string): Promise<void> => {
  await kuboPost('/api/v0/pin/add', new URLSearchParams({ arg: cid, recursive: 'true', progress: 'false' }));
};

export const getKuboRepoStat = async () => {
  const body = await kuboPost<RepoStat>('/api/v0/repo/stat', new URLSearchParams({ size_only: 'false' }));
  return {
    repoSizeBytes: typeof body.RepoSize === 'number' ? body.RepoSize : 0,
    storageMaxBytes: parseStorageMax(body.StorageMax)
  };
};

export const getKuboGatewayBaseUrl = () => getKuboGatewayUrl();

const kuboGatewayFetch = async (cid: string, method: 'GET' | 'HEAD') => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${getKuboGatewayUrl()}/ipfs/${encodeURIComponent(cid)}`, { method, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Kubo gateway request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

export const headCidFromGateway = async (cid: string) => kuboGatewayFetch(cid, 'HEAD');

export const getCidFromGateway = async (cid: string) => kuboGatewayFetch(cid, 'GET');

export const getGatewayReadableStream = (response: Response) => {
  if (!response.body) {
    return null;
  }
  return Readable.fromWeb(response.body as unknown as WebReadableStream);
};
