import type { JsonObject } from "@jitsu/protocols/reverse-etl";
import type { ScopedTargetState } from "@jitsu/protocols/reverse-etl-runtime";
import { contentHash } from "../../src/reverse-etl/identity";
import { OpenAiAdsCall, OpenAiAdsFetch, OpenAiWait } from "../../src/functions/openai-ads/ads-client";

/** Real audience ids are `caud_` plus 32 hex characters. */
export const audienceId = (n: number) => `caud_${n.toString(16).padStart(32, "0")}`;
export const hash = (n: number) => n.toString(16).padStart(64, "0");
export const ids = (n: number) => [{ identifier_type: "email_sha256" as const, identifier: hash(n) }];
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
export const refusal = (status: number, code: string, headers: Record<string, string> = {}) =>
  json({ error: { message: "private detail", type: "invalid_request_error", param: null, code } }, status, headers);

/**
 * A small fake of OpenAI's custom audience API, with the behavior seen on a real account on 22 Oct 2026:
 * ready about 17 s after create (503 on an Add before that), an Add or Remove taking about 12 s and queueing behind an
 * earlier one, the same key returning the same operation, and a malformed hash refused with 422 at submit.
 */
export function fakeAds() {
  let clock = 0;
  let nextAudience = 1;
  let nextOperation = 1;
  const audiences = new Map<string, { created: number; description: string; name: string; revision: number }>();
  const operations = new Map<
    string,
    { audience: string; action: string; finishes: number; key: string; body: string }
  >();
  const keys = new Map<string, string>();
  let lastFinish = 0;
  const log: string[] = [];
  const hooks: {
    operationStatus?: (calls: number) => string | Response;
    operationCalls: number;
    /** Runs before every request; return a Response to answer it instead of the fake. */
    intercept?: (
      route: string,
      init: Parameters<OpenAiAdsFetch>[1],
      count: number
    ) => Response | undefined | Promise<Response | undefined>;
  } = { operationCalls: 0 };
  let requests = 0;
  const audienceStatus = (a: { created: number }) =>
    clock - a.created >= 17_000 ? "ready" : clock - a.created >= 5_000 ? "publishing" : "rockset_ingest_pending";
  const opBody = (id: string, status?: string) => {
    const op = operations.get(id)!;
    return {
      operation_id: id,
      custom_audience_id: op.audience,
      operation: op.action,
      status: status ?? (clock >= op.finishes ? "succeeded" : "processing"),
    };
  };
  const fetch: OpenAiAdsFetch = async (url, init) => {
    const path = url.replace("https://api.ads.openai.com/v1", "");
    const [route, query = ""] = path.split("?");
    const params = new URLSearchParams(query);
    log.push(`${init.method} ${route}`);
    const intercepted = await hooks.intercept?.(route, init, ++requests);
    if (intercepted) return intercepted;
    if (init.headers.Authorization !== "Bearer ads-key") return json({ error: { code: "x", type: "x" } }, 401);
    if (route === "/ad_account") return json({ id: "adacct_test", name: "private name" });
    if (route === "/custom_audiences" && init.method === "POST") {
      const body = JSON.parse(init.body!);
      const id = audienceId(nextAudience++);
      audiences.set(id, { created: clock, description: body.description ?? "", name: body.name, revision: 0 });
      return json({ id, status: "rockset_ingest_pending", description: body.description, membership_revision: 0 });
    }
    if (route === "/custom_audiences") {
      const all = [...audiences.entries()].reverse();
      const start = params.get("after") ? all.findIndex(([id]) => id === params.get("after")) + 1 : 0;
      const page = all.slice(start, start + Number(params.get("limit") ?? 20));
      return json({
        object: "list",
        data: page.map(([id, a]) => ({ id, status: audienceStatus(a), description: a.description, name: a.name })),
        has_more: start + page.length < all.length,
        last_id: page.at(-1)?.[0] ?? null,
      });
    }
    let m = route.match(/^\/custom_audiences\/([^/]+)$/);
    if (m) {
      const a = audiences.get(m[1]);
      return a
        ? json({ id: m[1], status: audienceStatus(a), description: a.description, membership_revision: a.revision })
        : refusal(404, "not_found");
    }
    m = route.match(/^\/custom_audiences\/([^/]+)\/(add|remove)$/);
    if (m && init.method === "POST") {
      const a = audiences.get(m[1]);
      if (!a) return refusal(404, "not_found");
      const key = init.headers["Idempotency-Key"];
      if (!key) return refusal(400, "invalid_value");
      const body = JSON.parse(init.body!);
      if (keys.has(key)) return json(opBody(keys.get(key)!));
      if (audienceStatus(a) !== "ready") return refusal(503, "custom_audience_operation_unavailable");
      for (const i of body.identifiers)
        if (!/^[0-9a-f]{64}$/.test(i.identifier) && i.identifier_type.endsWith("sha256"))
          return refusal(422, "custom_audience_operation_invalid");
      const id = `caudop_${nextOperation++}`;
      lastFinish = Math.max(clock, lastFinish) + 12_000;
      operations.set(id, { audience: m[1], action: m[2], finishes: lastFinish, key, body: init.body! });
      keys.set(key, id);
      a.revision++;
      return json(opBody(id, "processing"));
    }
    m = route.match(/^\/custom_audiences\/([^/]+)\/operations\/([^/]+)(\/resume)?$/);
    if (m) {
      if (!m[3]) {
        hooks.operationCalls++;
        const forced = hooks.operationStatus?.(hooks.operationCalls);
        if (forced instanceof Response) return forced;
        if (forced) return json({ ...opBody(m[2]), status: forced });
      }
      return operations.has(m[2]) ? json(opBody(m[2])) : refusal(404, "not_found");
    }
    return refusal(404, "not_found");
  };
  const wait: OpenAiWait = {
    now: () => clock,
    sleep: async (ms, signal) => {
      signal.throwIfAborted();
      clock += ms;
    },
  };
  const call = (signal = new AbortController().signal): OpenAiAdsCall => ({ fetch, apiKey: "ads-key", signal });
  return {
    fetch,
    wait,
    call,
    log,
    hooks,
    operations,
    audiences,
    advance: (ms: number) => (clock += ms),
    time: () => clock,
  };
}

/** The runner's scoped target state, in memory: create-if-absent and compare-and-set on the saved JSON. */
export function memoryTargetState(initial?: JsonObject) {
  let value: JsonObject | undefined = initial;
  const state: ScopedTargetState = {
    read: async () => value && structuredClone(value),
    create: async next => {
      if (!value) value = structuredClone(next);
    },
    compareAndSet: async (expected, next) => {
      if (!value || contentHash(value) !== contentHash(expected)) return false;
      value = structuredClone(next);
      return true;
    },
  };
  return { state, get: () => value, set: (next: JsonObject | undefined) => (value = next) };
}
