import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { SegmentCredentials } from "../meta";

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

const SegmentDestination: JitsuFunction<AnalyticsServerEvent, SegmentCredentials> = async (event, ctx) => {
  ctx.log.debug(`Segment destination (props=${JSON.stringify(ctx.props)}) received event ${JSON.stringify(event)}`);
  //trim slash from apiBase
  let apiBase = ctx.props.apiBase;
  if (apiBase.charAt(apiBase.length - 1) === "/") {
    apiBase = apiBase.substring(0, apiBase.length - 1);
  }
  let httpRequest: HttpRequest = {
    url: `${apiBase}/${event.type}`,
    payload: event,
    method: "POST",
    headers: {
      "Content-type": "application/json",
      Authorization: `Basic ${getAuth(ctx.props)}`,
    },
  };
  try {
    const result = await ctx.fetch(httpRequest.url, {
      method: httpRequest.method,
      headers: httpRequest.headers,
      ...(httpRequest.payload ? { body: JSON.stringify(httpRequest.payload) } : {}),
    });
    if (result.status !== 200) {
      throw new RetryError(
        `Segment ${httpRequest.method} ${httpRequest.url}:${
          httpRequest.payload ? `${JSON.stringify(httpRequest.payload)} --> ` : ""
        }${result.status} ${await result.text()}`
      );
    } else {
      ctx.log.debug(`Segment ${httpRequest.method} ${httpRequest.url}: ${result.status} ${await result.text()}`);
    }
  } catch (e: any) {
    throw new RetryError(
      `Failed to send event to Segment: ${httpRequest.method} ${httpRequest.url} ${JSON.stringify(
        httpRequest.payload
      )}: ${e?.message}`
    );
  }
};

SegmentDestination.displayName = "segment-destination";

SegmentDestination.description =
  "Forward events for to Segment-compatible endpoint. It's useful if you want to use Jitsu for sending data to DWH and leave your existing Segment configuration for other purposes";

export default SegmentDestination;
