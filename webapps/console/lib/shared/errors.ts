import { LogFactory, randomId } from "juava";

export class ApiError extends Error {
  status?: number;
  responseObject: object;

  constructor(message: string, responseObject: object = {}, { status = 500 }: { status?: number } = {}) {
    super(message);
    this.status = status;
    this.responseObject = responseObject;
  }
}

export const syncError = (
  log: LogFactory,
  message: string,
  error: any,
  mask: boolean = false,
  ...privateArgs: any[]
) => {
  const errorId = randomId(8);
  const publicMessage = mask
    ? `Internal server error. Please contact support. Error ID: ${errorId}`
    : `${message}. Error ${errorId}: ${error}.`;
  log
    .atError()
    .withCause(error)
    .log(message, `Error ID: ${errorId}`, ...privateArgs);
  return {
    ok: false,
    error: publicMessage,
  };
};
