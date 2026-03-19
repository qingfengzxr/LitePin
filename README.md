# SuperIdea Pin Service

一个独立的内部服务，用来给 `backend` 提供自建 IPFS 的 `pin by CID` 能力。

它的职责很简单：

- 接收 backend 发来的 `cid`；
- 生成本地 `requestId`；
- 通过 Kubo API 执行 `pin/add`；
- 提供 `GET /pins/:requestId` 状态查询；
- 提供 `GET /stats` 查看 repo 使用情况。

这个服务默认只面向内网或本机，不应该直接暴露公网。

## 架构

```text
backend
   |
   v
pin-service
   |
   v
Kubo API (127.0.0.1:5001)
   |
   v
IPFS network
```

## 功能

- `POST /pins`
- `GET /pins/:requestId`
- `GET /stats`
- 本地 SQLite 持久化 pin 请求
- 后台 worker 串行消费 pin 请求
- 同 CID 去重
- 请求超时、自动重试、stale job 恢复
- 基于 repo 使用率的简单容量阈值保护
- 可选 Bearer Token 鉴权

## 环境变量

- `PORT`：默认 `4100`
- `HOST`：默认 `127.0.0.1`
- `PIN_SERVICE_TOKEN`：可选，若设置则所有接口都要求 `Authorization: Bearer <token>`
- `KUBO_API_URL`：默认 `http://127.0.0.1:5001`
- `KUBO_REQUEST_TIMEOUT_MS`：单次 Kubo API 请求超时，默认 `1800000`（30 分钟）
- `DATA_ROOT`：可选，默认优先 `/data`，否则 `./data`
- `PIN_DB_PATH`：可选，默认 `${DATA_ROOT}/pin-service.sqlite`
- `LOG_DIR` / `LOG_FILE`：可选，默认 `${DATA_ROOT}/logs` 和 `${DATA_ROOT}/logs/pin-service.log`
- `PIN_WORKER_POLL_MS`：后台轮询间隔，默认 `5000`
- `PIN_WORKER_CONCURRENCY`：并发 pin worker 数，默认 `1`
- `PIN_MAX_RETRIES`：单个请求最大尝试次数，默认 `3`
- `PIN_BASE_RETRY_MS`：首次重试退避，默认 `15000`
- `PIN_RUNNING_STALE_MS`：多久把卡住的 `pinning` 请求视为可恢复，默认 `3600000`（1 小时）
- `PIN_MAX_REPO_USAGE_RATIO`：repo 使用率阈值，默认 `0.9`

建议直接复制 `.env.example` 为 `.env`。

## 开发

```bash
cd /Users/cooper/Programming/git_home/SuperIdea/pin-service
npm install
npm run dev
```

## 生产

```bash
cd /Users/cooper/Programming/git_home/SuperIdea/pin-service
npm install
npm run build
npm start
```

## API

### `POST /pins`

请求：

```json
{
  "cid": "bafy...",
  "source": "crypto-os",
  "address": "0x...",
  "storageType": "ipfs"
}
```

返回：

```json
{
  "ok": true,
  "requestId": "pin-1742399999999-ab12cd",
  "cid": "bafy...",
  "status": "queued",
  "error": null
}
```

说明：

- 同一个 CID 重复提交时会复用已有记录；
- worker 拉起后会把状态更新为 `pinning` 或 `pinned`；
- 如果 Kubo 超时、短暂不可达或 CID 暂时不可用，会按退避策略自动重试；
- 超过最大尝试次数后才会进入 `failed`。

### `GET /pins/:requestId`

返回：

```json
{
  "requestId": "pin-1742399999999-ab12cd",
  "cid": "bafy...",
  "status": "pinned",
  "error": null,
  "errorCode": null,
  "attempts": 1,
  "nextRetryAt": null
}
```

状态取值：

- `queued`
- `pinning`
- `pinned`
- `failed`

### `GET /stats`

返回：

```json
{
  "storageMaxBytes": 214748364800,
  "repoSizeBytes": 123456789,
  "pinnedCount": 42,
  "acceptingNewPins": true
}
```

## 与 backend 的对接

在 `backend/.env` 里配置：

```env
BACKUP_ENABLED=true
PIN_PROVIDER=selfhosted-ipfs
PIN_SERVICE_URL=http://127.0.0.1:4100
PIN_SERVICE_TOKEN=replace-me
```

这样 backend 的 `BackupWorker` 会：

- `POST /pins`
- 记录返回的 `requestId`
- 之后持续 `GET /pins/:requestId`

## Kubo 要求

建议 Kubo 至少满足：

- API 监听在 `127.0.0.1:5001`
- 节点能够连接外部 IPFS 网络
- 节点已经设置合适的 `StorageMax`，例如 `200GB`
- Swarm 端口对公网可达，方便成为 provider

## 当前实现边界

这是为了尽快打通 `backend -> pin-service -> Kubo` 的最小版本。

当前还没有做这些增强能力：

- 用户级配额
- 更严格的磁盘字节级配额
- 并发控制以外的优先级调度
- 更细粒度的 CID 校验
- 多节点 Kubo 调度

## 关于并发 pin

现在已经支持安全并发 pin。

原因是本服务不是把任务“简单提交给 Kubo 就完事”，而是要自己维护：

- 本地 `requestId`
- 重试次数
- 超时和 stale 恢复
- backend 可轮询的状态

Kubo 的 `pin/add` 对调用方来说通常是一个长时间运行的同步请求，不会先返回一个可轮询的远端 job id。所以 `pin-service` 仍然需要自己的任务队列。

为了避免并发 worker 抢到同一条任务，当前实现已经把“取任务 + 标记 pinning”做成 SQLite 事务内的原子 claim，然后再用 `PIN_WORKER_CONCURRENCY` 控制并发度。

建议起步值：

- 小机器：`1`
- 一般单节点：`2` 或 `3`
- 不建议一开始就开很大，避免把带宽、磁盘 IO 和 Kubo 连接数打满

这些可以在后续迭代里再补。
