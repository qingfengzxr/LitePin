import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../infra/config.js';
import logger from '../infra/logger.js';
import { PinService } from '../services/pinService.js';
import { GatewayService } from '../services/gatewayService.js';
import { HealthService } from '../services/healthService.js';
import { DiagnosticsService } from '../services/diagnosticsService.js';
import { LitePinMetrics } from '../infra/metrics.js';
import { registerDocs } from './plugins/docs.js';
import { buildAuthPreHandler } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errorHandler.js';
import { registerDiagnosticsRoutes } from './routes/diagnostics.js';
import { registerPinRoutes } from './routes/pins.js';
import { registerGatewayRoutes } from './routes/gateway.js';
import { registerHealthRoutes } from './routes/health.js';

type BuildAppOptions = {
  config: AppConfig;
  pinService: PinService;
  gatewayService: GatewayService;
  healthService: HealthService;
  diagnosticsService: DiagnosticsService;
  metrics: LitePinMetrics;
};

type AppFastifyInstance = ReturnType<typeof Fastify>;

const registerPublicRoutes = async (
  app: AppFastifyInstance,
  options: Pick<BuildAppOptions, 'config' | 'pinService' | 'gatewayService'>
    & { requireAuth: ReturnType<typeof buildAuthPreHandler> }
) => {
  await app.register(
    async (publicApp: AppFastifyInstance) => {
      await registerPinRoutes(publicApp, { pinService: options.pinService, requireAuth: options.requireAuth });
      await registerGatewayRoutes(publicApp, { gatewayService: options.gatewayService, requireAuth: options.requireAuth });
    },
    { prefix: options.config.apiPrefix }
  );
};

const registerInternalRoutes = async (
  app: AppFastifyInstance,
  options: Pick<BuildAppOptions, 'healthService' | 'diagnosticsService'>
    & { requireAuth: ReturnType<typeof buildAuthPreHandler> }
) => {
  await registerHealthRoutes(app, { healthService: options.healthService });
  await registerDiagnosticsRoutes(app, { diagnosticsService: options.diagnosticsService, requireAuth: options.requireAuth });
};

export const buildApp = async (options: BuildAppOptions) => {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    bodyLimit: 1024 * 1024
  });

  registerErrorHandler(app);
  await registerDocs(app, options.config);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    (request as any).__startedAt = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startedAt = (request as any).__startedAt as bigint | undefined;
    if (!startedAt) {
      return;
    }
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const route = request.routeOptions.url || request.url;
    options.metrics.recordHttpRequest(request.method, route, reply.statusCode, durationMs);
  });

  const requireAuth = buildAuthPreHandler(options.config);
  await registerPublicRoutes(app, {
    config: options.config,
    pinService: options.pinService,
    gatewayService: options.gatewayService,
    requireAuth
  });
  await registerInternalRoutes(app, {
    healthService: options.healthService,
    diagnosticsService: options.diagnosticsService,
    requireAuth
  });

  return app;
};
