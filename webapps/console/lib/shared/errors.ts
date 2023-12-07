export class ApiError extends Error {
  status?: number;
  responseObject: object;

  constructor(message: string, responseObject: object = {}, { status = 500 }: { status?: number } = {}) {
    super(message);
    this.status = status;
    this.responseObject = responseObject;
  }
}
