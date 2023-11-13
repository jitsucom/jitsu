export const DropRetryErrorName = "Drop & RetryError";
export const RetryErrorName = "RetryError";

export class RetryError extends Error {
  constructor(message?: any, options?: { drop: boolean }) {
    super(message);
    this.name = options?.drop ? `${DropRetryErrorName}` : `${RetryErrorName}`;
  }
}

