export class ErrorDetailed<P = any> extends Error {
  private readonly _message: string
  private readonly _name: string
  private readonly _payload: P

  constructor(parameters: { message: string; name?: string; payload?: P }) {
    const { message, name, payload } = parameters
    super(message)
    this._message = message
    this._name = name
    this._payload = payload
  }

  get message(): string {
    return this._message
  }

  get name(): string {
    return this._name
  }

  get payload(): P {
    return this._payload
  }
}

export function getErrorMessage(e: any): string {
  return e?.message || "unknown error";
}
