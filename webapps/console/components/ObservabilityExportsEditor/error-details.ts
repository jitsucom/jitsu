import { ApiResponseError } from "juava";

/**
 * The error shown under "Show details" lists the request that failed. For the observability exports that request holds
 * the header values the user has just typed, so the error is shown without it.
 */
export function withoutRequest(e: any): any {
  return e instanceof ApiResponseError ? new ApiResponseError(e.message, e.response, {}) : e;
}
