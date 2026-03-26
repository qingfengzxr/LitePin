import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../infra/config.js';
import { unauthorized } from '../../domain/errors.js';

export const buildAuthPreHandler =
  (config: AppConfig) => async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!config.pinServiceToken) {
      return;
    }
    const auth = request.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    if (token !== config.pinServiceToken) {
      throw unauthorized();
    }
  };
