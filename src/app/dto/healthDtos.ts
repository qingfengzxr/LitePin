import { Type } from '@sinclair/typebox';

export const LivenessResponseDtoSchema = Type.Object(
  {
    ok: Type.Boolean()
  },
  { $id: 'LivenessResponseDto' }
);

export const ReadinessChecksDtoSchema = Type.Object(
  {
    database: Type.Boolean(),
    kuboApi: Type.Boolean(),
    worker: Type.Boolean()
  },
  { $id: 'ReadinessChecksDto' }
);

export const ReadinessResponseDtoSchema = Type.Object(
  {
    ok: Type.Boolean(),
    checks: ReadinessChecksDtoSchema
  },
  { $id: 'ReadinessResponseDto' }
);
