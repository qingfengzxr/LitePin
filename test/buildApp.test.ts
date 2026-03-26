import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { AppConfig } from '../src/infra/config.js';
import { LitePinMetrics } from '../src/infra/metrics.js';

process.env.DATA_ROOT = '/tmp/litepin-test';
process.env.LOG_DIR = '/tmp/litepin-test/logs';
process.env.LOG_FILE = '/tmp/litepin-test/logs/litepin.log';

const createConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  serviceName: 'LitePin',
  apiPrefix: '/api/v1',
  openApiTitle: 'LitePin API',
  openApiVersion: '0.1.0-test',
  port: 4100,
  host: '127.0.0.1',
  pinServiceToken: null,
  kuboApiUrl: 'http://127.0.0.1:5001',
  kuboGatewayUrl: 'http://127.0.0.1:8181',
  kuboRequestTimeoutMs: 1000,
  dataRoot: '/tmp/litepin-test',
  pinDbPath: '/tmp/litepin-test/pin.sqlite',
  logDir: '/tmp/litepin-test/logs',
  logFile: '/tmp/litepin-test/logs/litepin.log',
  logLevel: 'info',
  workerPollMs: 5000,
  workerConcurrency: 1,
  workerIdleLogMs: 600000,
  maxRetries: 3,
  baseRetryMs: 15000,
  runningStaleMs: 3600000,
  maxRepoUsageRatio: 0.9,
  provideAfterPin: true,
  shutdownGraceMs: 15000,
  ...overrides
});

const createTestApp = async (configOverrides: Partial<AppConfig> = {}) => {
  const { buildApp } = await import('../src/app/buildApp.js');
  const config = createConfig(configOverrides);
  const metrics = new LitePinMetrics();

  const pinService = {
    createOrReuseWithMeta: () => ({
      reused: false,
      record: {
        id: 'pin-123',
        cid: 'bafy123',
        source: 'crypto-os',
        address: '0xabc',
        storageType: 'ipfs',
        status: 'queued',
        error: null,
        errorCode: null,
        attempts: 0,
        nextRetryAt: null,
        lastPolledAt: null,
        createdAt: '2026-03-26T00:00:00.000Z',
        updatedAt: '2026-03-26T00:00:00.000Z',
        startedAt: null,
        completedAt: null,
        provideAttempts: 0,
        providedAt: null
      }
    }),
    getById: () => ({
      id: 'pin-123',
      cid: 'bafy123',
      status: 'pinned',
      error: null,
      errorCode: null,
      attempts: 1,
      nextRetryAt: null,
      startedAt: '2026-03-26T00:00:01.000Z',
      completedAt: '2026-03-26T00:00:02.000Z',
      provideAttempts: 1,
      providedAt: '2026-03-26T00:00:03.000Z'
    }),
    getStats: async () => ({
      storageMaxBytes: 1000,
      repoSizeBytes: 100,
      pinnedCount: 2,
      acceptingNewPins: true
    })
  };

  const gatewayService = {
    headCid: async () =>
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      }),
    getCid: async () =>
      new Response('hello-litepin', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'content-length': '13'
        }
      }),
    getGatewayReadableStream: (response: Response) => {
      if (!response.body) {
        return null;
      }
      return Readable.fromWeb(response.body as any);
    },
    probeCid: async () => ({
      cid: 'bafy123',
      pinned: true,
      readable: true,
      statusCode: 200,
      contentType: 'text/plain',
      contentLength: '13',
      gatewayUrl: config.kuboGatewayUrl
    })
  };

  const healthService = {
    getLiveness: () => ({ ok: true }),
    getReadiness: async () => ({
      ok: true,
      checks: {
        database: true,
        kuboApi: true,
        worker: true
      }
    })
  };

  const diagnosticsService = {
    getWorkerDiagnostics: () => ({
      running: true,
      stopping: false,
      activeWorkers: 0,
      configuredConcurrency: 1,
      pollIntervalMs: 5000,
      idleLogIntervalMs: 600000,
      lastIdleLogAt: null,
      provideAfterPin: true
    }),
    getQueueDiagnostics: () => ({
      counts: {
        queued: 1,
        pinning: 0,
        pinned: 2,
        failed: 0,
        total: 3
      },
      oldestQueuedAt: '2026-03-26T00:00:00.000Z',
      oldestPinningAt: null,
      latestCompletedAt: '2026-03-26T00:00:02.000Z',
      latestFailedAt: null,
      nextRetryAt: null
    }),
    getDependenciesDiagnostics: async () => ({
      database: {
        ok: true,
        path: config.pinDbPath
      },
      kuboApi: {
        ok: true,
        url: config.kuboApiUrl,
        repoSizeBytes: 100,
        storageMaxBytes: 1000,
        error: null
      },
      gateway: {
        url: config.kuboGatewayUrl
      }
    }),
    renderMetrics: async () =>
      '# HELP litepin_http_requests_total Total HTTP requests processed.\n# TYPE litepin_http_requests_total counter\nlitepin_http_requests_total{method="GET",route="/healthz",status_code="200"} 1\n'
  };

  const app = await buildApp({
    config,
    pinService: pinService as any,
    gatewayService: gatewayService as any,
    healthService: healthService as any,
    diagnosticsService: diagnosticsService as any,
    metrics
  });

  return { app, config };
};

test('POST /api/v1/pins returns expected response DTO', async (t) => {
  const { app } = await createTestApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/pins',
    payload: {
      cid: 'bafy123',
      source: 'crypto-os',
      address: '0xabc',
      storageType: 'ipfs'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    requestId: 'pin-123',
    cid: 'bafy123',
    status: 'queued',
    error: null,
    errorCode: null,
    attempts: 0,
    nextRetryAt: null,
    provideAttempts: 0,
    providedAt: null
  });
});

test('POST /api/v1/pins rejects invalid request body', async (t) => {
  const { app } = await createTestApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/pins',
    payload: {
      cid: ''
    }
  });

  assert.equal(response.statusCode, 400);
});

test('GET /api/v1/pins/:requestId returns status DTO', async (t) => {
  const { app } = await createTestApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/pins/pin-123'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'pinned');
});

test('GET /api/v1/stats returns stats DTO', async (t) => {
  const { app } = await createTestApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/stats'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    storageMaxBytes: 1000,
    repoSizeBytes: 100,
    pinnedCount: 2,
    acceptingNewPins: true
  });
});

test('gateway GET and HEAD routes work under /api/v1', async (t) => {
  const { app } = await createTestApp();
  t.after(async () => app.close());

  const headResponse = await app.inject({
    method: 'HEAD',
    url: '/api/v1/ipfs/bafy123'
  });
  assert.equal(headResponse.statusCode, 200);

  const getResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/ipfs/bafy123'
  });
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.body, 'hello-litepin');
});

test('GET /api/v1/probe/:cid returns probe DTO', async (t) => {
  const { app } = await createTestApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/probe/bafy123'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().gatewayUrl, 'http://127.0.0.1:8181');
});

test('internal health and diagnostics routes stay unprefixed', async (t) => {
  const { app } = await createTestApp();
  t.after(async () => app.close());

  const healthz = await app.inject({ method: 'GET', url: '/healthz' });
  const worker = await app.inject({ method: 'GET', url: '/diagnostics/worker' });
  const queue = await app.inject({ method: 'GET', url: '/diagnostics/queue' });
  const metrics = await app.inject({ method: 'GET', url: '/metrics' });

  assert.equal(healthz.statusCode, 200);
  assert.equal(worker.statusCode, 200);
  assert.equal(queue.statusCode, 200);
  assert.equal(metrics.statusCode, 200);
  assert.match(metrics.body, /litepin_http_requests_total/);
});

test('GET /readyz can return 503 when readiness fails', async (t) => {
  const { buildApp } = await import('../src/app/buildApp.js');
  const { app } = await createTestApp();
  t.after(async () => app.close());

  const failingApp = await buildApp({
    config: createConfig(),
    pinService: {
      createOrReuseWithMeta: () => {
        throw new Error('unused');
      },
      getById: () => {
        throw new Error('unused');
      },
      getStats: async () => ({ storageMaxBytes: null, repoSizeBytes: 0, pinnedCount: 0, acceptingNewPins: true })
    } as any,
    gatewayService: {
      headCid: async () => new Response(null, { status: 200 }),
      getCid: async () => new Response('ok', { status: 200 }),
      getGatewayReadableStream: (response: Response) => (response.body ? Readable.fromWeb(response.body as any) : null),
      probeCid: async () => ({
        cid: 'bafy123',
        pinned: false,
        readable: false,
        statusCode: 404,
        contentType: null,
        contentLength: null,
        gatewayUrl: 'http://127.0.0.1:8181'
      })
    } as any,
    healthService: {
      getLiveness: () => ({ ok: true }),
      getReadiness: async () => ({
        ok: false,
        checks: { database: false, kuboApi: true, worker: true }
      })
    } as any,
    diagnosticsService: {
      getWorkerDiagnostics: () => ({
        running: true,
        stopping: false,
        activeWorkers: 0,
        configuredConcurrency: 1,
        pollIntervalMs: 5000,
        idleLogIntervalMs: 600000,
        lastIdleLogAt: null,
        provideAfterPin: true
      }),
      getQueueDiagnostics: () => ({
        counts: { queued: 0, pinning: 0, pinned: 0, failed: 0, total: 0 },
        oldestQueuedAt: null,
        oldestPinningAt: null,
        latestCompletedAt: null,
        latestFailedAt: null,
        nextRetryAt: null
      }),
      getDependenciesDiagnostics: async () => ({
        database: { ok: false, path: '/tmp/test.sqlite' },
        kuboApi: { ok: true, url: 'http://127.0.0.1:5001', repoSizeBytes: 0, storageMaxBytes: null, error: null },
        gateway: { url: 'http://127.0.0.1:8181' }
      }),
      renderMetrics: async () => 'ok\n'
    } as any,
    metrics: new LitePinMetrics()
  });
  t.after(async () => failingApp.close());

  const response = await failingApp.inject({ method: 'GET', url: '/readyz' });
  assert.equal(response.statusCode, 503);
});

test('auth-protected public and internal routes reject invalid bearer token and allow valid token', async (t) => {
  const { app } = await createTestApp({ pinServiceToken: 'secret-token' });
  t.after(async () => app.close());

  const unauthorizedPublic = await app.inject({
    method: 'GET',
    url: '/api/v1/stats'
  });
  const unauthorizedInternal = await app.inject({
    method: 'GET',
    url: '/diagnostics/worker',
    headers: {
      authorization: 'Bearer wrong-token'
    }
  });
  const authorizedPublic = await app.inject({
    method: 'GET',
    url: '/api/v1/stats',
    headers: {
      authorization: 'Bearer secret-token'
    }
  });

  assert.equal(unauthorizedPublic.statusCode, 401);
  assert.equal(unauthorizedInternal.statusCode, 401);
  assert.equal(authorizedPublic.statusCode, 200);
});

test('docs endpoints respond and expose only versioned public API paths', async (t) => {
  const { app } = await createTestApp();
  t.after(async () => app.close());

  const docs = await app.inject({ method: 'GET', url: '/docs/' });
  const spec = await app.inject({ method: 'GET', url: '/docs/json' });

  assert.equal(docs.statusCode, 200);
  assert.equal(spec.statusCode, 200);

  const openApi = spec.json() as { paths: Record<string, unknown> };
  assert.ok(openApi.paths['/api/v1/pins']);
  assert.ok(openApi.paths['/api/v1/stats']);
  assert.ok(openApi.paths['/api/v1/probe/{cid}']);
  assert.equal(openApi.paths['/healthz'], undefined);
  assert.equal(openApi.paths['/diagnostics/worker'], undefined);
  assert.equal(openApi.paths['/metrics'], undefined);
});
