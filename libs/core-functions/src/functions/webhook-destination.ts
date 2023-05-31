import { JitsuFunction } from "@jitsu/protocols/functions";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { WebhookDestinationConfig } from "../meta";

const WebhookDestination: JitsuFunction<AnalyticsServerEvent, WebhookDestinationConfig> = async (event, ctx) => {
  const headers = ctx.props.headers || [];
  await ctx.fetch(ctx.props.url, {
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
  return event;
};

WebhookDestination.displayName = "webhook-destination";

export default WebhookDestination;
