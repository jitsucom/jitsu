import { createHash } from "node:crypto";
import { JitsuFunction } from "@jitsu/protocols/functions";
import { NoRetryError, RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import omit from "lodash/omit";
import { CUSTOMER_IO_HOSTS, CustomerIoCredentials } from "../meta";

/**
 * Customer.io rejects (in strict mode) a messageId longer than this.
 */
const MAX_MESSAGE_ID_LENGTH = 191;

/**
 * Event types accepted by the Customer.io Data Pipelines API: POST {host}/v1/{type}
 */
const SUPPORTED_TYPES = new Set(["identify", "track", "page", "screen", "group", "alias"]);

/**
 * Customer.io replaces an over-long messageId with a hash, but only in lax mode. In strict mode
 * (which this destination always uses, see below) it answers 400. So an over-long id is hashed
 * here. The hash is deterministic, so a retried event keeps the same id.
 *
 * `.length` counts UTF-16 code units, which can only over-count characters, so it errs toward hashing.
 */
function safeMessageId(messageId: unknown): unknown {
  if (typeof messageId === "string" && messageId.length > MAX_MESSAGE_ID_LENGTH) {
    return createHash("sha256").update(messageId).digest("hex");
  }
  return messageId;
}

const CustomerIoDestination: JitsuFunction<AnalyticsServerEvent, CustomerIoCredentials> = async (event, ctx) => {
  // Never log ctx.props here: it holds the private API key.
  const host = CUSTOMER_IO_HOSTS[ctx.props.region ?? "US"];
  if (!host) {
    throw new NoRetryError(`Unknown Customer.io region: ${ctx.props.region}`);
  }
  if (!SUPPORTED_TYPES.has(event.type)) {
    ctx.log.debug(`Customer.io: skipping unsupported event type '${event.type}'`);
    return;
  }

  // Jitsu's stream writeKey is not a Customer.io credential and must not be forwarded.
  const payload: Record<string, any> = omit(event, "writeKey");
  if (payload.messageId !== undefined) {
    payload.messageId = safeMessageId(payload.messageId);
  }

  const url = `${host}/v1/${event.type}`;
  let result: Response;
  let responseText: string;
  try {
    result = await ctx.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.props.apiKey}`,
        // Without strict mode, Customer.io answers 200 {"success":true} to a wrong key and drops the event.
        "X-Strict-Mode": "1",
      },
      body: JSON.stringify(payload),
    });
    responseText = await result.text();
  } catch (e: any) {
    // A plain Error is swallowed by rotor (the event would count as delivered), so wrap everything.
    throw new RetryError(`Failed to send event to Customer.io: POST ${url}: ${e?.message}`);
  }

  if (result.status >= 200 && result.status < 300) {
    ctx.log.debug(`Customer.io POST ${url}: ${result.status}`);
    return;
  }
  const message = `Customer.io POST ${url}: ${result.status} ${responseText}`;
  if (result.status === 400) {
    // Bad payload (invalid JSON, no userId/anonymousId, over 32KB...). The same event will fail again.
    throw new NoRetryError(message);
  }
  // 401/403/404 (bad, disabled or wrong-region key: may be fixed by the user while retries are pending),
  // 429 and 5xx.
  throw new RetryError(message);
};

CustomerIoDestination.displayName = "customer-io-destination";

CustomerIoDestination.description =
  "Send identify, track, page, screen, group and alias events to Customer.io through its Data Pipelines API.";

export default CustomerIoDestination;
