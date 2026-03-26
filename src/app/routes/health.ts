import type { FastifyInstance } from 'fastify';
import { HealthService } from '../../services/healthService.js';
import { LivenessResponseDtoSchema, ReadinessResponseDtoSchema } from '../dto/healthDtos.js';

type RegisterHealthRoutesOptions = {
  healthService: HealthService;
};

type AppFastifyInstance = FastifyInstance<any, any, any, any>;

export const registerHealthRoutes = async (app: AppFastifyInstance, options: RegisterHealthRoutesOptions) => {
  app.get(
    '/health',
    {
      schema: {
        hide: true,
        tags: ['health'],
        response: {
          200: LivenessResponseDtoSchema
        }
      }
    },
    async () => options.healthService.getLiveness()
  );

  app.get(
    '/healthz',
    {
      schema: {
        hide: true,
        tags: ['health'],
        response: {
          200: LivenessResponseDtoSchema
        }
      }
    },
    async () => options.healthService.getLiveness()
  );

  app.get(
    '/readyz',
    {
      schema: {
        hide: true,
        tags: ['health'],
        response: {
          200: ReadinessResponseDtoSchema,
          503: ReadinessResponseDtoSchema
        }
      }
    },
    async (_request, reply) => {
      const readiness = await options.healthService.getReadiness();
      return reply.code(readiness.ok ? 200 : 503).send(readiness);
    }
  );
};
