export class ApiError extends Error {
  status: number;
  responseObject: object;

  /**
   * `status` and `responseObject` both used to be positional objects, so passing
   * the status in the payload slot — `new ApiError(msg, { status: 403 })` — type
   * checked fine but silently answered 500 and leaked `status` into the response
   * body. Eleven call sites had it wrong. Keep them in one options bag so the
   * compiler can tell the two apart.
   */
  constructor(message: string, opts: { status?: number; responseObject?: object } = {}) {
    super(message);
    this.status = opts.status ?? 500;
    this.responseObject = opts.responseObject ?? {};
  }
}
