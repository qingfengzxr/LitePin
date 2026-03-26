import { buildApp } from './app/buildApp.js';
import { KuboClient } from './clients/kuboClient.js';
import logger, { getLogDir, getLogFile } from './infra/logger.js';
import { appConfig } from './infra/config.js';
import { LitePinMetrics } from './infra/metrics.js';
import { PinRepository } from './repositories/pinRepository.js';
import { PinService } from './services/pinService.js';
import { GatewayService } from './services/gatewayService.js';
import { HealthService } from './services/healthService.js';
import { DiagnosticsService } from './services/diagnosticsService.js';
import { PinWorker } from './workers/pinWorker.js';
import { WorkerRuntime } from './workers/runtime.js';

const main = async () => {
  const metrics = new LitePinMetrics();
  const repository = new PinRepository(appConfig.pinDbPath);
  const kuboClient = new KuboClient(appConfig);
  const pinService = new PinService(repository, kuboClient, appConfig.maxRepoUsageRatio, metrics);
  const gatewayService = new GatewayService(kuboClient);
  const pinWorker = new PinWorker(repository, kuboClient, appConfig, metrics);
  const workerRuntime = new WorkerRuntime(pinWorker);
  const healthService = new HealthService(repository, kuboClient, workerRuntime);
  const diagnosticsService = new DiagnosticsService(repository, kuboClient, workerRuntime, metrics, appConfig);

  const app = await buildApp({
    config: appConfig,
    pinService,
    gatewayService,
    healthService,
    diagnosticsService,
    metrics
  });

  logger.info(
    {
      serviceName: appConfig.serviceName,
      host: appConfig.host,
      port: appConfig.port,
      dataRoot: appConfig.dataRoot,
      logDir: getLogDir(),
      logFile: getLogFile(),
      pinDbPath: repository.dbPath,
      kuboApiUrl: appConfig.kuboApiUrl,
      kuboGatewayUrl: appConfig.kuboGatewayUrl
    },
    '[litepin] resolved runtime configuration'
  );

  workerRuntime.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[litepin] shutting down');
    try {
      await workerRuntime.stop(appConfig.shutdownGraceMs);
      await app.close();
      repository.close();
      logger.info('[litepin] shutdown complete');
      process.exit(0);
    } catch (err: any) {
      logger.error({ err, signal }, '[litepin] shutdown failed');
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  logger.info({ host: appConfig.host, port: appConfig.port }, '[litepin] about to listen');
  await app.listen({ host: appConfig.host, port: appConfig.port });
  logger.info({ host: appConfig.host, port: appConfig.port }, '[litepin] listening');
};

void main().catch((err) => {
  logger.error({ err }, '[litepin] failed to start');
  process.exit(1);
});
