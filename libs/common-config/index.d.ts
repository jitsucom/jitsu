/**
 * This file is here as our code assumes that
 * (await fetch()).json() returns Promise<any> (as in browser fetch),
 * while node fetch returns Promise<unknown> in @types/node
 */

declare global {
  interface Response {
    json<T = any>(): Promise<T>;
  }

  interface Body {
    json<T = any>(): Promise<T>;
  }
}

export {};
