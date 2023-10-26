import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { WebhookDestinationConfig } from "../meta";

const WebhookDestination: JitsuFunction<AnalyticsServerEvent, WebhookDestinationConfig> = async (event, ctx) => {
  try {
    const headers = ctx.props.headers || [];
    const res = await ctx.fetch(ctx.props.url, {
      method: ctx.props.method || "POST",
      body: JSON.stringify(event),
      headers: {
        "Content-Type": "application/json",
        ...headers.reduce((res, header) => {
          const [key, value] = header.split(":");
          return { ...res, [key]: value };
        }, {}),
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    }
    return event;
  } catch (e: any) {
    throw new RetryError(e.message);
  }
};

WebhookDestination.displayName = "webhook-destination";

export default WebhookDestination;
