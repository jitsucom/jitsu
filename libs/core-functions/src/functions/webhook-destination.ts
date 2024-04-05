import { JitsuFunction } from "@jitsu/protocols/functions";
import { HTTPError, RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { WebhookDestinationConfig } from "../meta";
import { createFetchWrapper, createFunctionLogger, JitsuFunctionWrapper } from "./lib";

const WebhookDestination: JitsuFunctionWrapper<AnalyticsServerEvent, WebhookDestinationConfig> = (
  chainCtx,
  funcCtx
) => {
  const log = createFunctionLogger(chainCtx, funcCtx);
  const fetch = createFetchWrapper(chainCtx, funcCtx);
  const props = funcCtx.props;

  const func: JitsuFunction<AnalyticsServerEvent> = async (event, ctx) => {
    try {
      const headers = props.headers || [];
      const res = await fetch(
        props.url,
        {
          method: props.method || "POST",
          body: JSON.stringify(event),
          headers: {
            "Content-Type": "application/json",
            ...headers.reduce((res, header) => {
              const [key, value] = header.split(":");
              return { ...res, [key]: value };
            }, {}),
          },
        },
        { event }
      );
      if (!res.ok) {
        throw new HTTPError(`HTTP Error: ${res.status} ${res.statusText}`, res.status, await res.text());
      } else {
        log.debug(`HTTP Status: ${res.status} ${res.statusText} Response: ${await res.text()}`);
      }
      return event;
    } catch (e: any) {
      throw new RetryError(e.message);
    }
  };

  func.displayName = "webhook-destination";

  return func;
};

export default WebhookDestination;
