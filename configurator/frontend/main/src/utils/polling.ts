import { assert } from "./typeCheck"

export interface IPoll<T> {
  start(): void
  wait(): Promise<T>
  cancel(): void
}

type EndPollingFunction<T> = (result: T) => void
type FailPollingFunction = (error?: Error) => void

export type PollingSetupCallback<T = unknown> = (
  end: EndPollingFunction<T>,
  fail: FailPollingFunction
) => VoidFunction | AsyncVoidFunction

/**
 * Class representing a polling instance that will run the passed callback periodically.
 */
export class Poll<T = unknown> implements IPoll<T> {
  private interval_ms: number = 1000
  private timeout_ms: number = 5 * 60 * 1000 // 5 min by default
  private callback: null | VoidFunction | AsyncVoidFunction = null
  private interval: null | ReturnType<typeof setTimeout> = null
  private timeout: null | ReturnType<typeof setTimeout> = null
  private resultPromise: null | Promise<T> = null
  private resultPromiseResolve: null | ((value: T | PromiseLike<T>) => void) = null
  private resultPromiseReject: null | ((reason: any) => void) = null
  private requestsBlocked: boolean = false
  private result: undefined | T

  /**
   * Creates a polling instane.
   * @param callback polling callback that provides the `end` function as the first argument. That function should be called like `end(result)` to stop the polling and return the result from the polling instance. The callback should return a function that will be polled.
   * @param interval_ms polling interval
   * @param timeout_ms polling timeout after which the poll will resolve with `null`
   */
  constructor(callback: PollingSetupCallback<T>, interval_ms?: number, timeout_ms?: number) {
    this.endPolling = this.endPolling.bind(this)
    this.failPolling = this.failPolling.bind(this)
    this.start = this.start.bind(this)
    this.wait = this.wait.bind(this)
    this.cancel = this.cancel.bind(this)

    if (interval_ms) this.interval_ms = interval_ms
    if (timeout_ms) this.timeout_ms = timeout_ms
    this.callback = callback(this.endPolling, this.failPolling)
  }

  private cleanup() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }

  private endPolling(result: T | null = null): void {
    this.result = result
    this.cleanup()
    this.resultPromiseResolve?.(result)
    this.resultPromiseResolve = null
  }

  private failPolling(error?: Error) {
    this.cleanup()
    if (this.resultPromiseReject) {
      this.resultPromiseReject(error || new Error("Polling silently failed. Please, see the stack trace for details."))
      this.resultPromiseReject = null
    }
  }

  /**
   * Initializes the polling.
   */
  public start(): void {
    if (this.interval) return
    // set up the variable for resolving the polling promise
    this.resultPromise = new Promise<T>((resolve, reject) => {
      this.resultPromiseResolve = resolve
      this.resultPromiseReject = reject
    })
    // set up the polling
    this.interval = setInterval(async () => {
      if (!this.requestsBlocked) {
        this.requestsBlocked = true
        ;(async () => this.callback())().then(() => {
          this.requestsBlocked = false
        })
      }
    }, this.interval_ms)
    this.timeout = setTimeout(this.endPolling, this.timeout_ms + 30) // 30ms safety margin for all calls to complete (to account for the minimum delay between the async calls)
  }

  /**
   * @returns The promise that will resolve to a result once the
   * polling is stopped; The result will be `null` if the polling
   * is force stopped with `.cancel()` or if the poll timed out.
   */
  public async wait(): Promise<T> {
    assert(
      !!this.resultPromise || typeof this.result !== "undefined",
      "`wait` function can not be called before calling the `start` function."
    )
    return this.resultPromise || this.result
  }

  /**
   * Force stops the polling and discards possible subsequent async updates,
   * yielding `wait` method to resolve with `null`
   */
  public cancel(): void {
    this.endPolling()
  }
}
