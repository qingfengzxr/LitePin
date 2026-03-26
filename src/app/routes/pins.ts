import type { FastifyInstance } from 'fastify';
import { Static } from '@sinclair/typebox';
import { PinService } from '../../services/pinService.js';
import {
  CreatePinRequestDtoSchema,
  CreatePinResponseDtoSchema,
  PinStatusResponseDtoSchema,
  StatsResponseDtoSchema
} from '../dto/pinDtos.js';
import { RequestIdParamsDtoSchema } from '../dto/common.js';

type CreatePinBody = Static<typeof CreatePinRequestDtoSchema>;
type RequestIdParams = Static<typeof RequestIdParamsDtoSchema>;

type RegisterPinRoutesOptions = {
  pinService: PinService;
  requireAuth: unknown;
};

type AppFastifyInstance = FastifyInstance<any, any, any, any>;

export const registerPinRoutes = async (app: AppFastifyInstance, options: RegisterPinRoutesOptions) => {
  app.post<{ Body: CreatePinBody }>(
    '/pins',
    {
      preHandler: options.requireAuth as any,
      schema: {
        tags: ['pins'],
        body: CreatePinRequestDtoSchema,
        response: {
          200: CreatePinResponseDtoSchema
        }
      }
    },
    async (request) => {
      const { record, reused } = options.pinService.createOrReuseWithMeta({
        cid: request.body.cid,
        source: request.body.source?.trim() || null,
        address: request.body.address?.trim() || null,
        storageType: request.body.storageType?.trim() || null
      });
      request.log.info(
        {
          requestId: record.id,
          cid: record.cid,
          status: record.status,
          reused,
          source: record.source,
          address: record.address,
          storageType: record.storageType
        },
        '[litepin] pin request accepted'
      );
      return {
        ok: true,
        requestId: record.id,
        cid: record.cid,
        status: record.status,
        error: record.error,
        errorCode: record.errorCode,
        attempts: record.attempts,
        nextRetryAt: record.nextRetryAt,
        provideAttempts: record.provideAttempts,
        providedAt: record.providedAt
      };
    }
  );

  app.get<{ Params: RequestIdParams }>(
    '/pins/:requestId',
    {
      preHandler: options.requireAuth as any,
      schema: {
        tags: ['pins'],
        params: RequestIdParamsDtoSchema,
        response: {
          200: PinStatusResponseDtoSchema
        }
      }
    },
    async (request) => {
      const record = options.pinService.getById(request.params.requestId);
      return {
        requestId: record.id,
        cid: record.cid,
        status: record.status,
        error: record.error,
        errorCode: record.errorCode,
        attempts: record.attempts,
        nextRetryAt: record.nextRetryAt,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        provideAttempts: record.provideAttempts,
        providedAt: record.providedAt
      };
    }
  );

  app.get(
    '/stats',
    {
      preHandler: options.requireAuth as any,
      schema: {
        tags: ['pins'],
        response: {
          200: StatsResponseDtoSchema
        }
      }
    },
    async () => options.pinService.getStats()
  );
};
