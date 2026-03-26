import { Type } from '@sinclair/typebox';
import { NullableStringDtoSchema } from './common.js';

export const CreatePinRequestDtoSchema = Type.Object(
  {
    cid: Type.String({ minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9]+$' }),
    source: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    address: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    storageType: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
  },
  { $id: 'CreatePinRequestDto' }
);

export const PinStatusResponseDtoSchema = Type.Object(
  {
    requestId: Type.String(),
    cid: Type.String(),
    status: Type.String(),
    error: NullableStringDtoSchema,
    errorCode: NullableStringDtoSchema,
    attempts: Type.Integer(),
    nextRetryAt: NullableStringDtoSchema,
    startedAt: NullableStringDtoSchema,
    completedAt: NullableStringDtoSchema,
    provideAttempts: Type.Integer(),
    providedAt: NullableStringDtoSchema
  },
  { $id: 'PinStatusResponseDto' }
);

export const CreatePinResponseDtoSchema = Type.Object(
  {
    ok: Type.Boolean(),
    requestId: Type.String(),
    cid: Type.String(),
    status: Type.String(),
    error: NullableStringDtoSchema,
    errorCode: NullableStringDtoSchema,
    attempts: Type.Integer(),
    nextRetryAt: NullableStringDtoSchema,
    provideAttempts: Type.Integer(),
    providedAt: NullableStringDtoSchema
  },
  { $id: 'CreatePinResponseDto' }
);

export const StatsResponseDtoSchema = Type.Object(
  {
    storageMaxBytes: Type.Union([Type.Integer(), Type.Null()]),
    repoSizeBytes: Type.Integer(),
    pinnedCount: Type.Integer(),
    acceptingNewPins: Type.Boolean()
  },
  { $id: 'StatsResponseDto' }
);
