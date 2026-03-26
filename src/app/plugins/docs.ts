import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../infra/config.js';

type AppFastifyInstance = FastifyInstance<any, any, any, any>;

export const registerDocs = async (app: AppFastifyInstance, config: AppConfig) => {
  await app.register(swagger, {
    stripBasePath: false,
    openapi: {
      info: {
        title: config.openApiTitle,
        description: 'An open-source, lightweight Pinata-like pinning service built on Fastify, TypeBox, SQLite, and Kubo.',
        version: config.openApiVersion
      },
      servers: [
        {
          url: config.apiPrefix,
          description: 'Versioned public LitePin API'
        }
      ],
      tags: [
        { name: 'pins', description: 'Pin request lifecycle' },
        { name: 'gateway', description: 'CID gateway and probe endpoints' }
      ]
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    }
  });
};
