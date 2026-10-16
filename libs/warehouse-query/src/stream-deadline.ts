/** Time out an outstanding read, not the consumer's work between reads. */
export class StreamDeadline {
  private readonly controller = new AbortController();
  private readonly overall: ReturnType<typeof setTimeout>;
  readonly signal: AbortSignal;
  constructor(parent?: AbortSignal, private readonly readMs = 30_000, overallMs = 2 * 60 * 60 * 1000) {
    this.signal = parent ? AbortSignal.any([parent, this.controller.signal]) : this.controller.signal;
    this.overall = setTimeout(
      () => this.controller.abort(new Error("Warehouse extraction deadline exceeded")),
      overallMs
    );
    this.overall.unref?.();
  }
  async read<T>(operation: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    const timer = setTimeout(() => this.controller.abort(new Error("Warehouse read timed out")), this.readMs);
    try {
      return await this.wait(operation);
    } finally {
      clearTimeout(timer);
    }
  }
  /** Wait for server-side execution under the overall deadline, not the read timeout. */
  async wait<T>(operation: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    let onAbort: () => void;
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          this.signal.throwIfAborted();
          return operation();
        }),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(this.signal.reason);
          this.signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      this.signal.removeEventListener("abort", onAbort!);
    }
  }
  close() {
    clearTimeout(this.overall);
    this.controller.abort();
  }
}
