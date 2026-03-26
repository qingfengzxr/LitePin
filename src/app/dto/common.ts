import { Type } from '@sinclair/typebox';

export const NullableStringDtoSchema = Type.Union([Type.String(), Type.Null()]);

export const CidParamsDtoSchema = Type.Object(
  {
    cid: Type.String({ minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9]+$' })
  },
  { $id: 'CidParamsDto' }
);

export const RequestIdParamsDtoSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1, maxLength: 128 })
  },
  { $id: 'RequestIdParamsDto' }
);
