import express from 'express';
import './env.js';
import logger, { getLogDir, getLogFile } from './logger.js';
import { dataRoot } from './storagePaths.js';
import {
  createOrReusePinRequest,
  getPinDbPath,
  getPinRequestById,
  getPinnedCount
} from './pinStore.js';
import { getKuboRepoStat } from './kuboClient.js';
import { MAX_REPO_USAGE_RATIO, PinWorker } from './pinWorker.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const port = Number(process.env.PORT || 4100);
const host = process.env.HOST || '127.0.0.1';
const expectedToken = process.env.PIN_SERVICE_TOKEN?.trim() || '';

const sendJson = (res: express.Response, data: unknown, status = 200) => res.status(status).json(data);

const requireAuth: express.RequestHandler = (req, res, next) => {
  if (!expectedToken) {
    return next();
  }
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (token !== expectedToken) {
    return sendJson(res, { error: 'Unauthorized' }, 401);
  }
  next();
};

const normalizeCid = (value: unknown) => {
  const cid = typeof value === 'string' ? value.trim() : '';
  if (!cid) {
    throw new Error('cid required');
  }
  if (!/^[a-z0-9]+$/i.test(cid) || cid.length > 256) {
    throw new Error('invalid cid');
  }
  return cid;
};

app.get('/health', (_req, res) => sendJson(res, { ok: true }));

app.post('/pins', requireAuth, (req, res) => {
  try {
    const cid = normalizeCid(req.body?.cid);
    const source = typeof req.body?.source === 'string' ? req.body.source.trim() : null;
    const address = typeof req.body?.address === 'string' ? req.body.address.trim() : null;
    const storageType = typeof req.body?.storageType === 'string' ? req.body.storageType.trim() : null;
    const record = createOrReusePinRequest({ cid, source, address, storageType });
    logger.info(
      {
        requestId: record.id,
        cid: record.cid,
        status: record.status,
        source: record.source,
        address: record.address,
        storageType: record.storageType
      },
      '[pin-service] pin request accepted'
    );
    return sendJson(res, {
      ok: true,
      requestId: record.id,
      cid: record.cid,
      status: record.status,
      error: record.error,
      errorCode: record.errorCode,
      attempts: record.attempts,
      nextRetryAt: record.nextRetryAt
    });
  } catch (err: any) {
    logger.warn({ err }, '[pin-service] create pin request failed');
    return sendJson(res, { error: err?.message || 'Failed to create pin request' }, 400);
  }
});

app.get('/pins/:requestId', requireAuth, (req, res) => {
  const record = getPinRequestById(req.params.requestId);
  if (!record) {
    return sendJson(res, { error: 'Not found' }, 404);
  }
  return sendJson(res, {
    requestId: record.id,
    cid: record.cid,
    status: record.status,
    error: record.error,
    errorCode: record.errorCode,
    attempts: record.attempts,
    nextRetryAt: record.nextRetryAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt
  });
});

app.get('/stats', requireAuth, async (_req, res) => {
  try {
    const repo = await getKuboRepoStat();
    const acceptingNewPins =
      !repo.storageMaxBytes || repo.storageMaxBytes <= 0 ? true : repo.repoSizeBytes / repo.storageMaxBytes < MAX_REPO_USAGE_RATIO;
    logger.info(
      {
        repoSizeBytes: repo.repoSizeBytes,
        storageMaxBytes: repo.storageMaxBytes,
        pinnedCount: getPinnedCount(),
        acceptingNewPins
      },
      '[pin-service] stats requested'
    );
    return sendJson(res, {
      storageMaxBytes: repo.storageMaxBytes,
      repoSizeBytes: repo.repoSizeBytes,
      pinnedCount: getPinnedCount(),
      acceptingNewPins
    });
  } catch (err: any) {
    logger.error({ err }, '[pin-service] stats request failed');
    return sendJson(res, { error: err?.message || 'Failed to fetch stats' }, 500);
  }
});

logger.info(
  {
    dataRoot,
    logDir: getLogDir(),
    logFile: getLogFile(),
    pinDbPath: getPinDbPath(),
    kuboApiUrl: process.env.KUBO_API_URL || 'http://127.0.0.1:5001'
  },
  '[pin-service] resolved persistent storage paths'
);

new PinWorker().start();

app.listen(port, host, () => {
  logger.info({ host, port }, '[pin-service] listening');
});
