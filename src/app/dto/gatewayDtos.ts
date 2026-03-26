import { Type } from '@sinclair/typebox';
import { NullableStringDtoSchema } from './common.js';

export const ProbeCidResponseDtoSchema = Type.Object(
  {
    cid: Type.String(),
    pinned: Type.Boolean(),
    readable: Type.Boolean(),
    statusCode: Type.Integer(),
    contentType: NullableStringDtoSchema,
    contentLength: NullableStringDtoSchema,
    gatewayUrl: Type.String()
  },
  { $id: 'ProbeCidResponseDto' }
);
