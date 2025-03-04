import { JitsuFunction } from "@jitsu/protocols/functions";
import { HTTPError, RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { WebhookDestinationConfig } from "../meta";
import { MetricsMeta } from "./lib";

const bulkerBase = process.env.BULKER_URL;
const bulkerAuthKey = process.env.BULKER_AUTH_KEY;

const macrosPattern = /\{\{\s*([\w.-]+)\s*}}/g;

const WebhookDestination: JitsuFunction<AnalyticsServerEvent, WebhookDestinationConfig> = async (event, ctx) => {
  if (ctx["connectionOptions"]?.mode === "batch" && bulkerBase) {
    const metricsMeta: Omit<MetricsMeta, "messageId"> = {
      workspaceId: ctx.workspace.id,
      streamId: ctx.source.id,
      destinationId: ctx.destination.id,
      connectionId: ctx.connection.id,
      functionId: "builtin.destination.bulker",
    };

    try {
      const res = await ctx.fetch(
        `${bulkerBase}/post/${ctx.connection.id}?tableName=${event.event || event.type}&modeOverride=batch`,
        {
          method: "POST",
          body: JSON.stringify(event),
          headers: {
            ...(bulkerAuthKey ? { Authorization: `Bearer ${bulkerAuthKey}` } : {}),
            metricsMeta: JSON.stringify(metricsMeta),
          },
        },
        { log: false }
      );
      if (!res.ok) {
        throw new HTTPError(
          `Failed to batch event. HTTP Error: ${res.status} ${res.statusText}`,
          res.status,
          (await res.text())?.substring(0, 255)
        );
      } else {
        ctx.log.debug(
          `Failed to batch event. HTTP Status: ${res.status} ${res.statusText} Response: ${(
            await res.text()
          )?.substring(0, 255)}`
        );
      }
      return event;
    } catch (e: any) {
      throw new RetryError(e.message);
    }
  } else {
    try {
      let payload: string;
      if (ctx.props.customPayload) {
        const cp = JSON.parse(ctx.props.payload ?? "");
        payload = cp.code.replace(macrosPattern, (match, macroName) => {
          switch (macroName.toUpperCase()) {
            case "EVENT":
              return JSON.stringify(event);
            case "EVENTS":
              return JSON.stringify([event]);
            case "EVENTS_COUNT":
              return "1";
            case "NAME":
            case "EVENTS_NAME":
              return event.event || event.type;
            default:
              if (macroName.startsWith("env.")) {
                return ctx.connection.options?.["functionsEnv"]?.[macroName.substring(4)] || "";
              }
              return match;
          }
        });
      } else {
        payload = JSON.stringify(event);
      }
      const headers = ctx.props.headers || [];
      const res = await ctx.fetch(ctx.props.url, {
        method: ctx.props.method || "POST",
        body: payload,
        headers: {
          "Content-Type": "application/json",
          ...headers.reduce((res, header) => {
            const [key, value] = header.split(":");
            return { ...res, [key]: value };
          }, {}),
        },
      });
      if (!res.ok) {
        throw new HTTPError(
          `HTTP Error: ${res.status} ${res.statusText}`,
          res.status,
          (await res.text())?.substring(0, 255)
        );
      } else {
        ctx.log.debug(
          `HTTP Status: ${res.status} ${res.statusText} Response: ${(await res.text())?.substring(0, 255)}`
        );
      }
      return event;
    } catch (e: any) {
      throw new RetryError(e.message);
    }
  }
};

WebhookDestination.displayName = "webhook-destination";

export default WebhookDestination;
