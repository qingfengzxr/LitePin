type CounterMap = Map<string, number>;

const keyForLabels = (labels: Record<string, string | number>) =>
  Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(',');

const formatLabels = (labels: Record<string, string | number>) =>
  Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`)
    .join(',');

export class LitePinMetrics {
  private readonly httpRequestsTotal: CounterMap = new Map();
  private readonly httpRequestDurationMsSum: CounterMap = new Map();
  private readonly httpRequestDurationMsCount: CounterMap = new Map();
  private pinRequestsCreatedTotal = 0;
  private pinRequestsReusedTotal = 0;
  private workerJobsCompletedTotal = 0;
  private workerJobsFailedTotal = 0;
  private workerJobsRetriedTotal = 0;
  private workerProvideFailuresTotal = 0;

  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number) {
    const labels = { method, route, status_code: statusCode };
    this.increment(this.httpRequestsTotal, labels, 1);
    this.increment(this.httpRequestDurationMsSum, labels, durationMs);
    this.increment(this.httpRequestDurationMsCount, labels, 1);
  }

  recordPinRequestAccepted(reused: boolean) {
    if (reused) {
      this.pinRequestsReusedTotal += 1;
      return;
    }
    this.pinRequestsCreatedTotal += 1;
  }

  recordWorkerJobCompleted() {
    this.workerJobsCompletedTotal += 1;
  }

  recordWorkerJobFailed() {
    this.workerJobsFailedTotal += 1;
  }

  recordWorkerJobRetried() {
    this.workerJobsRetriedTotal += 1;
  }

  recordWorkerProvideFailure() {
    this.workerProvideFailuresTotal += 1;
  }

  renderPrometheus(snapshot: {
    queueCounts: Record<string, number>;
    worker: { activeWorkers: number; running: boolean; stopping: boolean };
    repo: { repoSizeBytes: number | null; storageMaxBytes: number | null };
  }) {
    const lines: string[] = [];

    lines.push('# HELP litepin_http_requests_total Total HTTP requests processed.');
    lines.push('# TYPE litepin_http_requests_total counter');
    lines.push(...this.renderCounterMap('litepin_http_requests_total', this.httpRequestsTotal));

    lines.push('# HELP litepin_http_request_duration_ms_sum Sum of HTTP request durations in milliseconds.');
    lines.push('# TYPE litepin_http_request_duration_ms_sum counter');
    lines.push(...this.renderCounterMap('litepin_http_request_duration_ms_sum', this.httpRequestDurationMsSum));

    lines.push('# HELP litepin_http_request_duration_ms_count Count of HTTP request durations in milliseconds.');
    lines.push('# TYPE litepin_http_request_duration_ms_count counter');
    lines.push(...this.renderCounterMap('litepin_http_request_duration_ms_count', this.httpRequestDurationMsCount));

    lines.push('# HELP litepin_pin_requests_created_total Total new pin requests accepted.');
    lines.push('# TYPE litepin_pin_requests_created_total counter');
    lines.push(`litepin_pin_requests_created_total ${this.pinRequestsCreatedTotal}`);

    lines.push('# HELP litepin_pin_requests_reused_total Total deduplicated pin requests reused.');
    lines.push('# TYPE litepin_pin_requests_reused_total counter');
    lines.push(`litepin_pin_requests_reused_total ${this.pinRequestsReusedTotal}`);

    lines.push('# HELP litepin_worker_jobs_completed_total Total worker jobs completed.');
    lines.push('# TYPE litepin_worker_jobs_completed_total counter');
    lines.push(`litepin_worker_jobs_completed_total ${this.workerJobsCompletedTotal}`);

    lines.push('# HELP litepin_worker_jobs_failed_total Total worker jobs failed.');
    lines.push('# TYPE litepin_worker_jobs_failed_total counter');
    lines.push(`litepin_worker_jobs_failed_total ${this.workerJobsFailedTotal}`);

    lines.push('# HELP litepin_worker_jobs_retried_total Total worker jobs retried.');
    lines.push('# TYPE litepin_worker_jobs_retried_total counter');
    lines.push(`litepin_worker_jobs_retried_total ${this.workerJobsRetriedTotal}`);

    lines.push('# HELP litepin_worker_provide_failures_total Total worker provide-after-pin failures.');
    lines.push('# TYPE litepin_worker_provide_failures_total counter');
    lines.push(`litepin_worker_provide_failures_total ${this.workerProvideFailuresTotal}`);

    lines.push('# HELP litepin_queue_requests Queue size by status.');
    lines.push('# TYPE litepin_queue_requests gauge');
    for (const [status, value] of Object.entries(snapshot.queueCounts)) {
      lines.push(`litepin_queue_requests{status="${status}"} ${value}`);
    }

    lines.push('# HELP litepin_worker_active_workers Active worker count.');
    lines.push('# TYPE litepin_worker_active_workers gauge');
    lines.push(`litepin_worker_active_workers ${snapshot.worker.activeWorkers}`);

    lines.push('# HELP litepin_worker_running Worker running state.');
    lines.push('# TYPE litepin_worker_running gauge');
    lines.push(`litepin_worker_running ${snapshot.worker.running ? 1 : 0}`);

    lines.push('# HELP litepin_worker_stopping Worker stopping state.');
    lines.push('# TYPE litepin_worker_stopping gauge');
    lines.push(`litepin_worker_stopping ${snapshot.worker.stopping ? 1 : 0}`);

    lines.push('# HELP litepin_kubo_repo_size_bytes Kubo repo size in bytes.');
    lines.push('# TYPE litepin_kubo_repo_size_bytes gauge');
    lines.push(`litepin_kubo_repo_size_bytes ${snapshot.repo.repoSizeBytes ?? 0}`);

    lines.push('# HELP litepin_kubo_storage_max_bytes Kubo storage max in bytes.');
    lines.push('# TYPE litepin_kubo_storage_max_bytes gauge');
    lines.push(`litepin_kubo_storage_max_bytes ${snapshot.repo.storageMaxBytes ?? 0}`);

    return `${lines.join('\n')}\n`;
  }

  private increment(map: CounterMap, labels: Record<string, string | number>, delta: number) {
    const key = keyForLabels(labels);
    map.set(key, (map.get(key) || 0) + delta);
  }

  private renderCounterMap(name: string, map: CounterMap) {
    return [...map.entries()].map(([rawKey, value]) => {
      const labels = Object.fromEntries(
        rawKey.split(',').filter(Boolean).map((part) => {
          const [key, rawValue] = part.split('=');
          return [key, rawValue];
        })
      );
      const labelString = formatLabels(labels);
      return `${name}{${labelString}} ${value}`;
    });
  }
}
