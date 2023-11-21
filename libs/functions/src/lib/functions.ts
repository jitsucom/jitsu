export const DropRetryErrorName = "Drop & RetryError";
export const RetryErrorName = "RetryError";

export class RetryError extends Error {
  status: number;
  response: string;
  message: string;
  constructor(message?: any, options?: { drop: boolean }) {
    if (typeof message === "object") {
      super(message.message);
      this.message = message.message;
      this.status = message.status;
      this.response = message.response;
    } else {
      super(message);
      this.message = message;
    }
    this.name = options?.drop ? `${DropRetryErrorName}` : `${RetryErrorName}`;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      response: this.response,
    };
  }
}

export class HTTPError extends Error {
  status: number;
  response: string;
  message: string;
  constructor(message: string, status: number, response: string) {
    super(message);
    this.message = message;
    this.name = "HTTPError";
    this.status = status;
    this.response = response.length > 1000 ? response.slice(0, 1000) + "..." : response;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      response: this.response,
    };
  }
}
