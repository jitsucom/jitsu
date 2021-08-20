import { assert } from './typeCheck';

export interface IPoll {
  start(): void;
  wait(): Promise<void>;
  cancel(): void;
}

export type PollingSetupCallback = () => boolean;

/**
 * Class representing a polling instance that will run the passed callback periodically.
 */
export class Poll implements IPoll {
  private interval_ms: number = 1000;
  private timeout_ms: number = 5 * 60 * 1000; // 5 minutes by default
  private interval: null | ReturnType<typeof setTimeout> = null;
  private callback: null | PollingSetupCallback = null;
  private timeout: null | ReturnType<typeof setTimeout> = null;
  private resultPromise: null | Promise<void> = null;
  private resultPromiseResolve:
    | null
    | ((value: null | PromiseLike<null>) => void) = null;
  private resultPromiseReject: null | ((reason: any) => void) = null;

  /**
   * Creates a polling instane.
   * @param callback polling callback that provides the `end` function as the first argument. That function should be called like `end(result)` to stop the polling and return the result from the polling instance. The callback should return a function that will be polled.
   * @param interval_ms polling interval
   * @param timeout_ms polling timeout after which the poll will resolve with `null`
   */
  constructor(
    callback: PollingSetupCallback,
    interval_ms?: number,
    timeout_ms?: number
  ) {
    if (interval_ms) this.interval_ms = interval_ms;
    if (timeout_ms) this.timeout_ms = timeout_ms;
    this.callback = callback;

    this.endPolling = this.endPolling.bind(this);
    this.failPolling = this.failPolling.bind(this);
    this.start = this.start.bind(this);
    this.wait = this.wait.bind(this);
    this.cancel = this.cancel.bind(this);
  }

  private cleanup() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  private endPolling(): void {
    this.cleanup();
    if (this.resultPromiseResolve) {
      this.resultPromiseResolve(null);
      this.resultPromiseResolve = null;
    }
  }

  private failPolling(error?: Error) {
    this.cleanup();
    if (this.resultPromiseReject) {
      this.resultPromiseReject(
        error ||
          new Error(
            'Polling failed silently. Please, see the stack trace for detailes.'
          )
      );
      this.resultPromiseReject = null;
    }
  }

  /**
   * Initializes the polling.
   */
  public start(): void {
    if (this.interval) return;
    // set up the variable for resolving the polling promise
    this.resultPromise = new Promise<void>((resolve, reject) => {
      this.resultPromiseResolve = resolve;
      this.resultPromiseReject = reject;
    });
    // set up the polling
    this.interval = setInterval(async () => {
      try {
        const needToStopPolling: boolean = await this.callback();
        if (needToStopPolling) this.endPolling();
      } catch (error) {
        this.failPolling(error);
      }
    }, this.interval_ms);
    this.timeout = setTimeout(this.endPolling, this.timeout_ms + 20); // safety margin for calls to complete
  }

  /**
   * @returns The promise that will resolve once the polling is
   * stopped; The result will be `null` if the polling is force
   * stopped with `.cancel()` or if the poll timed out.
   */
  public async wait(): Promise<void> {
    assert(
      !!this.resultPromise,
      '`wait` function can not be called before calling the `start` function.'
    );
    return this.resultPromise;
  }

  /**
   * Force stops the polling and discards possible subsequent async updates,
   * yielding `wait` method to resolve with `null`
   */
  public cancel(): void {
    this.endPolling();
  }
}
