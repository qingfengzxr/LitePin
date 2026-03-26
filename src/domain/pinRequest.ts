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

export type CreatePinRequestInput = {
  cid: string;
  source?: string | null;
  address?: string | null;
  storageType?: string | null;
};

export type RepoStats = {
  repoSizeBytes: number;
  storageMaxBytes: number | null;
};
