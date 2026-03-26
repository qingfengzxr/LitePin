import { Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import './loadEnv.js';
import { dataRoot, resolveDataPath } from './storagePaths.js';

const AppConfigSchema = Type.Object({
  serviceName: Type.String({ minLength: 1 }),
  apiPrefix: Type.String({ minLength: 1 }),
  openApiTitle: Type.String({ minLength: 1 }),
  openApiVersion: Type.String({ minLength: 1 }),
  port: Type.Integer({ minimum: 1, maximum: 65535 }),
  host: Type.String({ minLength: 1 }),
  pinServiceToken: Type.Union([Type.String(), Type.Null()]),
  kuboApiUrl: Type.String({ minLength: 1 }),
  kuboGatewayUrl: Type.String({ minLength: 1 }),
  kuboRequestTimeoutMs: Type.Integer({ minimum: 1_000 }),
  dataRoot: Type.String({ minLength: 1 }),
  pinDbPath: Type.String({ minLength: 1 }),
  logDir: Type.String({ minLength: 1 }),
  logFile: Type.String({ minLength: 1 }),
  logLevel: Type.String({ minLength: 1 }),
  workerPollMs: Type.Integer({ minimum: 100 }),
  workerConcurrency: Type.Integer({ minimum: 1 }),
  workerIdleLogMs: Type.Integer({ minimum: 1_000 }),
  maxRetries: Type.Integer({ minimum: 1 }),
  baseRetryMs: Type.Integer({ minimum: 1_000 }),
  runningStaleMs: Type.Integer({ minimum: 60_000 }),
  maxRepoUsageRatio: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
  provideAfterPin: Type.Boolean(),
  shutdownGraceMs: Type.Integer({ minimum: 1_000 })
});

export type AppConfig = Static<typeof AppConfigSchema>;

const asInteger = (value: string | undefined, fallback: number) => {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  const parsed = Number(normalized);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
};

const asNumber = (value: string | undefined, fallback: number) => {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const asBoolean = (value: string | undefined, fallback: boolean) => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const config: AppConfig = {
  serviceName: 'LitePin',
  apiPrefix: process.env.API_PREFIX?.trim() || '/api/v1',
  openApiTitle: process.env.OPENAPI_TITLE?.trim() || 'LitePin API',
  openApiVersion: process.env.OPENAPI_VERSION?.trim() || process.env.npm_package_version?.trim() || '0.1.0',
  port: asInteger(process.env.PORT, 4100),
  host: process.env.HOST?.trim() || '127.0.0.1',
  pinServiceToken: process.env.PIN_SERVICE_TOKEN?.trim() || null,
  kuboApiUrl: (process.env.KUBO_API_URL?.trim() || 'http://127.0.0.1:5001').replace(/\/+$/, ''),
  kuboGatewayUrl: (process.env.KUBO_GATEWAY_URL?.trim() || 'http://127.0.0.1:8181').replace(/\/+$/, ''),
  kuboRequestTimeoutMs: asInteger(process.env.KUBO_REQUEST_TIMEOUT_MS, 30 * 60 * 1000),
  dataRoot,
  pinDbPath: process.env.PIN_DB_PATH?.trim() || resolveDataPath('pin-service.sqlite'),
  logDir: process.env.LOG_DIR?.trim() || resolveDataPath('logs'),
  logFile: process.env.LOG_FILE?.trim() || resolveDataPath('logs', 'litepin.log'),
  logLevel: process.env.LOG_LEVEL?.trim() || 'info',
  workerPollMs: asInteger(process.env.PIN_WORKER_POLL_MS, 5_000),
  workerConcurrency: Math.max(1, asInteger(process.env.PIN_WORKER_CONCURRENCY, 1)),
  workerIdleLogMs: asInteger(process.env.PIN_WORKER_IDLE_LOG_MS, 10 * 60_000),
  maxRetries: asInteger(process.env.PIN_MAX_RETRIES, 3),
  baseRetryMs: asInteger(process.env.PIN_BASE_RETRY_MS, 15_000),
  runningStaleMs: asInteger(process.env.PIN_RUNNING_STALE_MS, 60 * 60 * 1000),
  maxRepoUsageRatio: asNumber(process.env.PIN_MAX_REPO_USAGE_RATIO, 0.9),
  provideAfterPin: asBoolean(process.env.PIN_PROVIDE_AFTER_PIN, true),
  shutdownGraceMs: asInteger(process.env.SHUTDOWN_GRACE_MS, 15_000)
};

if (!Value.Check(AppConfigSchema, config)) {
  const errors = [...Value.Errors(AppConfigSchema, config)].map((entry) => `${entry.path || '/'} ${entry.message}`).join('; ');
  throw new Error(`Invalid LitePin configuration: ${errors}`);
}

export const appConfig = config;
