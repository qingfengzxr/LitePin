import type { FastifyInstance } from 'fastify';
import { isAppError } from '../../domain/errors.js';

type AppFastifyInstance = FastifyInstance<any, any, any, any>;

export const registerErrorHandler = (app: AppFastifyInstance) => {
  app.setErrorHandler((error, request, reply) => {
    if ((error as any).validation) {
      request.log.warn({ err: error }, '[litepin] request validation failed');
      return reply.status(400).send({
        error: 'Invalid request',
        code: 'validation_error',
        details: (error as any).validation
      });
    }

    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details
      });
    }

    request.log.error({ err: error }, '[litepin] unhandled request error');
    return reply.status(500).send({
      error: 'Internal server error',
      code: 'internal_error'
    });
  });
};
