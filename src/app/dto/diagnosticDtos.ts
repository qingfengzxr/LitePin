import { Type } from '@sinclair/typebox';
import { NullableStringDtoSchema } from './common.js';

export const QueueCountsDtoSchema = Type.Object(
  {
    queued: Type.Integer(),
    pinning: Type.Integer(),
    pinned: Type.Integer(),
    failed: Type.Integer(),
    total: Type.Integer()
  },
  { $id: 'QueueCountsDto' }
);

export const WorkerDiagnosticsResponseDtoSchema = Type.Object(
  {
    running: Type.Boolean(),
    stopping: Type.Boolean(),
    activeWorkers: Type.Integer(),
    configuredConcurrency: Type.Integer(),
    pollIntervalMs: Type.Integer(),
    idleLogIntervalMs: Type.Integer(),
    lastIdleLogAt: NullableStringDtoSchema,
    provideAfterPin: Type.Boolean()
  },
  { $id: 'WorkerDiagnosticsResponseDto' }
);

export const QueueDiagnosticsResponseDtoSchema = Type.Object(
  {
    counts: QueueCountsDtoSchema,
    oldestQueuedAt: NullableStringDtoSchema,
    oldestPinningAt: NullableStringDtoSchema,
    latestCompletedAt: NullableStringDtoSchema,
    latestFailedAt: NullableStringDtoSchema,
    nextRetryAt: NullableStringDtoSchema
  },
  { $id: 'QueueDiagnosticsResponseDto' }
);

export const DependenciesDiagnosticsResponseDtoSchema = Type.Object(
  {
    database: Type.Object({
      ok: Type.Boolean(),
      path: Type.String()
    }),
    kuboApi: Type.Object({
      ok: Type.Boolean(),
      url: Type.String(),
      repoSizeBytes: Type.Union([Type.Integer(), Type.Null()]),
      storageMaxBytes: Type.Union([Type.Integer(), Type.Null()]),
      error: NullableStringDtoSchema
    }),
    gateway: Type.Object({
      url: Type.String()
    })
  },
  { $id: 'DependenciesDiagnosticsResponseDto' }
);
