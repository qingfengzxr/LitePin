import type { FastifyInstance } from 'fastify';
import { DiagnosticsService } from '../../services/diagnosticsService.js';
import {
  DependenciesDiagnosticsResponseDtoSchema,
  QueueDiagnosticsResponseDtoSchema,
  WorkerDiagnosticsResponseDtoSchema
} from '../dto/diagnosticDtos.js';

type RegisterDiagnosticsRoutesOptions = {
  diagnosticsService: DiagnosticsService;
  requireAuth: unknown;
};

type AppFastifyInstance = FastifyInstance<any, any, any, any>;

export const registerDiagnosticsRoutes = async (app: AppFastifyInstance, options: RegisterDiagnosticsRoutesOptions) => {
  app.get(
    '/diagnostics/worker',
    {
      preHandler: options.requireAuth as any,
      schema: {
        hide: true,
        tags: ['diagnostics'],
        response: {
          200: WorkerDiagnosticsResponseDtoSchema
        }
      }
    },
    async () => options.diagnosticsService.getWorkerDiagnostics()
  );

  app.get(
    '/diagnostics/queue',
    {
      preHandler: options.requireAuth as any,
      schema: {
        hide: true,
        tags: ['diagnostics'],
        response: {
          200: QueueDiagnosticsResponseDtoSchema
        }
      }
    },
    async () => options.diagnosticsService.getQueueDiagnostics()
  );

  app.get(
    '/diagnostics/dependencies',
    {
      preHandler: options.requireAuth as any,
      schema: {
        hide: true,
        tags: ['diagnostics'],
        response: {
          200: DependenciesDiagnosticsResponseDtoSchema
        }
      }
    },
    async () => options.diagnosticsService.getDependenciesDiagnostics()
  );

  app.get(
    '/metrics',
    {
      preHandler: options.requireAuth as any,
      schema: {
        hide: true
      }
    },
    async (_request, reply) => {
      const body = await options.diagnosticsService.renderMetrics();
      reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
      return reply.send(body);
    }
  );
};
