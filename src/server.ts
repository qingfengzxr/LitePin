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
import {
  getCidFromGateway,
  getGatewayReadableStream,
  getKuboGatewayBaseUrl,
  getKuboRepoStat,
  headCidFromGateway,
  isPinnedInKubo
} from './kuboClient.js';
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

const copyGatewayHeaders = (gatewayResponse: Response, res: express.Response) => {
  for (const header of ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'content-disposition']) {
    const value = gatewayResponse.headers.get(header);
    if (value) {
      res.setHeader(header, value);
    }
  }
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
      nextRetryAt: record.nextRetryAt,
      provideAttempts: record.provideAttempts,
      providedAt: record.providedAt
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
      completedAt: record.completedAt,
      provideAttempts: record.provideAttempts,
      providedAt: record.providedAt
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

app.head('/ipfs/:cid', requireAuth, async (req, res) => {
  try {
    const cid = normalizeCid(req.params.cid);
    logger.info({ method: req.method, path: req.originalUrl, cid, ip: req.ip }, '[pin-service] gateway HEAD request received');
    const gatewayResponse = await headCidFromGateway(cid);
    copyGatewayHeaders(gatewayResponse, res);
    logger.info(
      { cid, statusCode: gatewayResponse.status, gatewayUrl: getKuboGatewayBaseUrl() },
      '[pin-service] gateway HEAD request completed'
    );
    return res.status(gatewayResponse.status).end();
  } catch (err: any) {
    logger.warn({ err, cid: req.params.cid }, '[pin-service] gateway HEAD request failed');
    return sendJson(res, { error: err?.message || 'Failed to read CID from gateway' }, 502);
  }
});

app.get('/ipfs/:cid', requireAuth, async (req, res) => {
  try {
    const cid = normalizeCid(req.params.cid);
    logger.info({ method: req.method, path: req.originalUrl, cid, ip: req.ip }, '[pin-service] gateway GET request received');
    const gatewayResponse = await getCidFromGateway(cid);
    copyGatewayHeaders(gatewayResponse, res);
    res.status(gatewayResponse.status);
    logger.info(
      { cid, statusCode: gatewayResponse.status, gatewayUrl: getKuboGatewayBaseUrl() },
      '[pin-service] gateway GET request completed'
    );
    if (!gatewayResponse.ok || !gatewayResponse.body) {
      const body = await gatewayResponse.text();
      return res.send(body);
    }
    const stream = getGatewayReadableStream(gatewayResponse);
    if (!stream) {
      return res.end();
    }
    stream.on('error', (err) => {
      logger.warn({ err, cid }, '[pin-service] gateway stream failed');
      if (!res.headersSent) {
        res.status(502).end('Gateway stream failed');
        return;
      }
      res.destroy(err);
    });
    stream.pipe(res);
  } catch (err: any) {
    logger.warn({ err, cid: req.params.cid }, '[pin-service] gateway GET request failed');
    return sendJson(res, { error: err?.message || 'Failed to stream CID from gateway' }, 502);
  }
});

app.get('/probe/:cid', requireAuth, async (req, res) => {
  try {
    const cid = normalizeCid(req.params.cid);
    logger.info({ method: req.method, path: req.originalUrl, cid, ip: req.ip }, '[pin-service] CID probe request received');
    const pinned = await isPinnedInKubo(cid);
    const gatewayResponse = await headCidFromGateway(cid);
    const readable = gatewayResponse.ok;
    const result = {
      cid,
      pinned,
      readable,
      statusCode: gatewayResponse.status,
      contentType: gatewayResponse.headers.get('content-type'),
      contentLength: gatewayResponse.headers.get('content-length'),
      gatewayUrl: getKuboGatewayBaseUrl()
    };
    logger.info(result, '[pin-service] CID probe completed');
    return sendJson(res, result);
  } catch (err: any) {
    logger.warn({ err, cid: req.params.cid }, '[pin-service] CID probe failed');
    return sendJson(
      res,
      {
        cid: req.params.cid,
        pinned: false,
        readable: false,
        error: err?.message || 'Failed to probe CID',
        gatewayUrl: getKuboGatewayBaseUrl()
      },
      502
    );
  }
});

logger.info(
  {
    dataRoot,
    logDir: getLogDir(),
    logFile: getLogFile(),
    pinDbPath: getPinDbPath(),
    kuboApiUrl: process.env.KUBO_API_URL || 'http://127.0.0.1:5001',
    kuboGatewayUrl: process.env.KUBO_GATEWAY_URL || 'http://127.0.0.1:8181'
  },
  '[pin-service] resolved persistent storage paths'
);

new PinWorker().start();

app.listen(port, host, () => {
  logger.info({ host, port }, '[pin-service] listening');
});
