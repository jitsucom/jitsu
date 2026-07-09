import { createHmac, createPrivateKey, sign } from "crypto";
import { JitsuFunction } from "@jitsu/protocols/functions";
import { HTTPError, NoRetryError, NoRetryErrorName, RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { WebhookDestinationConfig } from "../meta";
import { MetricsMeta } from "@jitsu/core-functions-lib";
import { bulkerPartitionParam } from "./bulker-destination";

const bulkerBase = process.env.BULKER_URL;
const bulkerAuthKey = process.env.BULKER_AUTH_KEY;

const macrosPattern = /\{\{\s*([\w.-]+)\s*}}/g;

// Accepts an Ed25519 private key as full PEM or as the bare base64 PKCS#8 body
// (with any surrounding whitespace), returning a PEM string createPrivateKey parses.
function toPrivateKeyPem(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes("-----BEGIN")) {
    return trimmed;
  }
  const body =
    trimmed
      .replace(/\s+/g, "")
      .match(/.{1,64}/g)
      ?.join("\n") ?? trimmed;
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

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
        `${bulkerBase}/post/${ctx.connection.id}?tableName=${
          event.event || event.type
        }&modeOverride=batch${bulkerPartitionParam(ctx, event)}`,
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
      const signatureHeaders: Record<string, string> = {};
      const method = ctx.props.signatureMethod || "none";
      if (method !== "none") {
        const secret = method === "hmac" ? ctx.props.signatureSecret : undefined;
        const privateKey = method === "ed25519" ? ctx.props.signaturePrivateKey : undefined;
        if (!secret && !privateKey) {
          // Method selected but no key — fail loudly instead of silently sending unsigned.
          throw new NoRetryError(
            `Webhook signing method "${method}" is enabled but no ${
              method === "hmac" ? "secret" : "private key"
            } is configured`
          );
        }
        const headerName = ctx.props.signatureHeader || "Jitsu-Signature";
        let signedData = payload;
        let timestamp: string | undefined;
        if (ctx.props.signatureIncludeTimestamp ?? true) {
          timestamp = String(Math.floor(Date.now() / 1000));
          signedData = `${timestamp}.${payload}`;
        }
        try {
          signatureHeaders[headerName] = secret
            ? createHmac("sha256", secret).update(signedData).digest("hex")
            : sign(null, Buffer.from(signedData), createPrivateKey(toPrivateKeyPem(privateKey!))).toString("hex");
        } catch (e: any) {
          // A malformed key/secret can never succeed on retry — drop instead of retrying forever.
          throw new NoRetryError(`Webhook signing failed, check the signing key/secret: ${e.message}`);
        }
        if (timestamp) {
          signatureHeaders[`${headerName}-Timestamp`] = timestamp;
        }
      }
      const res = await ctx.fetch(ctx.props.url, {
        method: ctx.props.method || "POST",
        body: payload,
        headers: {
          "Content-Type": "application/json",
          ...headers.reduce((res, header) => {
            const [key, value] = header.split(":");
            return { ...res, [key]: value };
          }, {}),
          ...signatureHeaders,
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
      if (e.name === NoRetryErrorName) {
        throw e;
      }
      throw new RetryError(e.message);
    }
  }
};

WebhookDestination.displayName = "webhook-destination";

export default WebhookDestination;
