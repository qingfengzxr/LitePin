# LitePin

LitePin is an open-source pinning service that provides a simple, self-hostable pin service API for `pin by CID` workflows on top of Kubo.

It is designed for teams that want:

- a lightweight HTTP API for submitting pin requests;
- durable local persistence with SQLite;
- background job execution with retries and stale-job recovery;
- gateway and probe endpoints for CID verification;
- a deployment model simple enough to run on a single node or private network.

LitePin is intentionally small. It focuses on a clean operational model rather than multi-tenant billing, dashboards, or hosted-platform complexity.

## Architecture

```text
client / upstream service
        |
        v
LitePin API (Fastify + TypeBox)
        |
        +--> SQLite request store
        |
        +--> Pin worker
                |
                v
             Kubo API
                |
                v
            IPFS network
```

## Features

- `POST /pins` to enqueue or reuse a pin request by CID
- `GET /pins/:requestId` to query request status
- `GET /stats` for repository capacity and pinned object summary
- `GET /ipfs/:cid` and `HEAD /ipfs/:cid` as a thin gateway passthrough
- `GET /probe/:cid` to check pin state and gateway readability
- `GET /healthz` and `GET /readyz` for liveness and readiness checks
- `GET /docs` for OpenAPI/Swagger documentation
- `GET /diagnostics/worker`, `GET /diagnostics/queue`, `GET /diagnostics/dependencies`
- `GET /metrics` for Prometheus-style metrics
- SQLite-backed durable queue state
- background worker with retries and stale-job reclaim
- optional Bearer token protection
- structured logging with `pino`

## Project Structure

```text
src/
  app/
    buildApp.ts
    dto/
    plugins/
    routes/
  clients/
    kuboClient.ts
  domain/
    errors.ts
    pinRequest.ts
  infra/
    config.ts
    loadEnv.ts
    logger.ts
    storagePaths.ts
  repositories/
    pinRepository.ts
  services/
    gatewayService.ts
    healthService.ts
    pinService.ts
  workers/
    pinWorker.ts
    runtime.ts
  server.ts
```

## Environment Variables

- `PORT`: default `4100`
- `HOST`: default `127.0.0.1`
- `API_PREFIX`: default `/api/v1`
- `OPENAPI_TITLE`: default `LitePin API`
- `OPENAPI_VERSION`: default package version or `0.1.0`
- `PIN_SERVICE_TOKEN`: optional Bearer token for protected endpoints
- `KUBO_API_URL`: default `http://127.0.0.1:5001`
- `KUBO_GATEWAY_URL`: default `http://127.0.0.1:8181`
- `KUBO_REQUEST_TIMEOUT_MS`: default `1800000`
- `DATA_ROOT`: default `/data` if present, otherwise `./data`
- `PIN_DB_PATH`: default `${DATA_ROOT}/pin-service.sqlite`
- `LOG_DIR`: default `${DATA_ROOT}/logs`
- `LOG_FILE`: default `${DATA_ROOT}/logs/litepin.log`
- `LOG_LEVEL`: default `info`
- `PIN_WORKER_POLL_MS`: default `5000`
- `PIN_WORKER_CONCURRENCY`: default `1`
- `PIN_WORKER_IDLE_LOG_MS`: default `600000`
- `PIN_MAX_RETRIES`: default `3`
- `PIN_BASE_RETRY_MS`: default `15000`
- `PIN_RUNNING_STALE_MS`: default `3600000`
- `PIN_MAX_REPO_USAGE_RATIO`: default `0.9`
- `PIN_PROVIDE_AFTER_PIN`: default `true`
- `SHUTDOWN_GRACE_MS`: default `15000`

Copy `.env.example` to `.env` to get started.

## Development

```bash
cd LitePin
npm install
npm test
npm run dev
```

## Production

```bash
cd LitePin
npm install
npm run build
npm test
npm start
```

## API

### `POST /api/v1/pins`

Request:

```json
{
  "cid": "bafy...",
  "source": "crypto-os",
  "address": "0x...",
  "storageType": "ipfs"
}
```

Response:

```json
{
  "ok": true,
  "requestId": "pin-1742399999999-ab12cd",
  "cid": "bafy...",
  "status": "queued",
  "error": null,
  "errorCode": null,
  "attempts": 0,
  "nextRetryAt": null,
  "provideAttempts": 0,
  "providedAt": null
}
```

### `GET /api/v1/pins/:requestId`

Response:

```json
{
  "requestId": "pin-1742399999999-ab12cd",
  "cid": "bafy...",
  "status": "pinned",
  "error": null,
  "errorCode": null,
  "attempts": 1,
  "nextRetryAt": null,
  "startedAt": "2026-03-26T10:00:00.000Z",
  "completedAt": "2026-03-26T10:00:05.000Z",
  "provideAttempts": 1,
  "providedAt": "2026-03-26T10:00:06.000Z"
}
```

### `GET /api/v1/stats`

Response:

```json
{
  "storageMaxBytes": 214748364800,
  "repoSizeBytes": 123456789,
  "pinnedCount": 42,
  "acceptingNewPins": true
}
```

### `GET /readyz`

Response:

```json
{
  "ok": true,
  "checks": {
    "database": true,
    "kuboApi": true,
    "worker": true
  }
}
```

### `GET /docs`

Serves Swagger UI for the LitePin OpenAPI specification.

### `GET /docs/json`

Returns the machine-readable OpenAPI JSON document for the public API.

### `GET /diagnostics/worker`

Returns worker runtime state, concurrency settings, and idle-log diagnostics.

### `GET /diagnostics/queue`

Returns queue counts and queue-age timestamps for `queued`, `pinning`, `pinned`, and `failed` jobs.

### `GET /diagnostics/dependencies`

Returns dependency diagnostics for SQLite, Kubo API, and configured gateway base URL.

### `GET /metrics`

Returns Prometheus-style metrics including:

- HTTP request totals and duration aggregates
- pin request accepted and reused totals
- worker completed / failed / retried totals
- queue size gauges
- worker state gauges
- Kubo repo size gauges

## Kubo Requirements

- Keep the Kubo API on localhost or a private network
- Do not expose the Kubo API directly to the public internet
- Configure a realistic `StorageMax`
- Ensure the node can reach the wider IPFS network
- If you want strong provider discoverability, make swarm ports reachable

## Integration Pattern

LitePin is a good fit when another service needs a clean pinning API but you still want to own the underlying Kubo node.

Typical flow:

1. An upstream service calls `POST /pins`
2. LitePin stores or reuses a request record in SQLite
3. The background worker claims and executes the pin job
4. The upstream service polls `GET /pins/:requestId`
5. Optionally, the upstream service uses `GET /probe/:cid` or `GET /ipfs/:cid`

## Scope

LitePin is intentionally focused. It does not currently include:

- user-level quotas
- billing or tenant isolation
- multi-node Kubo scheduling
- dashboard UI
- advanced policy engines

Those can be layered on later, but the core service is meant to stay small, predictable, and easy to self-host.
