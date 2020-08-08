import { debugName, IEventBase } from "./src/track";

declare global {
  
  interface Window {
    eventN?: IEventBase;
    eventnLogLevel?: debugName
    analytics: {
      addSourceMiddleware(fn: (chain: { payload: any, next: (payload: any) => void, integrations: any }) => void): void
    }
  }
  interface String {
    endsWith(searchString: string, endPosition?: number): boolean;
  }
}

