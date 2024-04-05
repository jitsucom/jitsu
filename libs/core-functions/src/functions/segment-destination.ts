import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { SegmentCredentials } from "../meta";
import { createFetchWrapper, createFunctionLogger, JitsuFunctionWrapper } from "./lib";

export type HttpRequest = {
  method?: string;
  url: string;
  payload?: any;
  headers?: Record<string, string>;
};

function base64(str: string) {
  return btoa(str);
}

function getAuth(props: SegmentCredentials) {
  return base64(`${props.writeKey}:`);
}

const SegmentDestination: JitsuFunctionWrapper<AnalyticsServerEvent, SegmentCredentials> = (chainCtx, funcCtx) => {
  const log = createFunctionLogger(chainCtx, funcCtx);
  const fetch = createFetchWrapper(chainCtx, funcCtx);
  const props = funcCtx.props;

  const func: JitsuFunction<AnalyticsServerEvent> = async (event, ctx) => {
    //trim slash from apiBase
    let apiBase = props.apiBase;
    if (apiBase.charAt(apiBase.length - 1) === "/") {
      apiBase = apiBase.substring(0, apiBase.length - 1);
    }
    let httpRequest: HttpRequest = {
      url: `${apiBase}/${event.type}`,
      payload: event,
      method: "POST",
      headers: {
        "Content-type": "application/json",
        Authorization: `Basic ${getAuth(props)}`,
      },
    };
    try {
      const result = await fetch(
        httpRequest.url,
        {
          method: httpRequest.method,
          headers: httpRequest.headers,
          ...(httpRequest.payload ? { body: JSON.stringify(httpRequest.payload) } : {}),
        },
        { event }
      );
      const logMessage = `Segment ${httpRequest.method} ${httpRequest.url}: ${result.status} ${await result.text()}`;
      if (result.status !== 200) {
        throw new RetryError(logMessage);
      } else {
        log.debug(logMessage);
      }
    } catch (e: any) {
      throw new RetryError(
        `Failed to send event to Segment: ${httpRequest.method} ${httpRequest.url} ${JSON.stringify(
          httpRequest.payload
        )}: ${e?.message}`
      );
    }
  };

  func.displayName = "segment-destination";

  func.description =
    "Forward events for to Segment-compatible endpoint. It's useful if you want to use Jitsu for sending data to DWH and leave your existing Segment configuration for other purposes";

  return func;
};
export default SegmentDestination;
