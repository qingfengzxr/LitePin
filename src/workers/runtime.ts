import { PinWorker } from './pinWorker.js';

export class WorkerRuntime {
  constructor(private readonly pinWorker: PinWorker) {}

  start() {
    this.pinWorker.start();
  }

  async stop(graceMs?: number) {
    await this.pinWorker.stop(graceMs);
  }

  isRunning() {
    return this.pinWorker.isRunning();
  }

  getSnapshot() {
    return this.pinWorker.getSnapshot();
  }
}
