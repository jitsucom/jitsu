import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deliverBatch, idempotencyKey, maxRequestBytes, type DeliveryDeps } from "../src/functions/webhook/deliver";
import { GuardedRequestError, type GuardedRequest, type GuardedResponse } from "../src/functions/lib/guarded-request";
import { createWebhookRuntime, webhookRecovery } from "../src/functions/webhook/runtime";
import {
  normalizeRowValue,
  validateWebhookDestination,
  validateWebhookReverseSettings,
  WebhookConfigError,
  WebhookRowsOptions,
} from "../src/functions/webhook/reverse-meta";
import { signatureHeaders } from "../src/functions/webhook/signing";
import { createWebhookWriter } from "../src/functions/webhook/writer";
import { reverseDestinationRuntime } from "../src/reverse-etl/runtime";

const destination = { url: "https://example.com/hook", method: "POST" };
const options = { deliveryAttested: true as const };

type Step = number | GuardedRequestError | { status: number; retryAfter?: string };

function fakeDeps(steps: Step[]) {
  const requests: GuardedRequest[] = [];
  const sleeps: number[] = [];
  const deps: DeliveryDeps = {
    send: async request => {
      requests.push(request);
      const step = steps.length > 1 ? steps.shift()! : steps[0];
      if (step instanceof GuardedRequestError) throw step;
      const response = typeof step === "number" ? { status: step } : step;
      return { truncated: false, ...response } as GuardedResponse;
    },
    sleep: async ms => {
      sleeps.push(ms);
    },
    now: () => new Date("2026-10-05T10:00:00Z"),
  };
  return { deps, requests, sleeps };
}

const records = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ operationId: `op${i}`, key: `k${i}`, row: { id: i, name: `n${i}` } }));

const scope = { syncId: "sync1", runId: "run1" };
const parsedOptions = (extra: object = {}) => WebhookRowsOptions.parse({ ...options, ...extra });
const config = (extra: object = {}) => validateWebhookDestination({ ...destination, ...extra });

function deliver(steps: Step[], recs = records(1), extra: object = {}, cfg: object = {}) {
  const fake = fakeDeps(steps);
  const promise = deliverBatch({
    records: recs,
    action: "upsert",
    scope,
    config: config(cfg),
    options: parsedOptions(extra),
    signal: new AbortController().signal,
    deps: fake.deps,
  });
  return { ...fake, promise };
}

describe("webhook delivery", () => {
  it("accepts every record on 2xx and sends the documented envelope", async () => {
    const { promise, requests } = deliver([204], records(2));
    const outcomes = await promise;
    expect(outcomes).toEqual([
      { operationId: "op0", status: "accepted" },
      { operationId: "op1", status: "accepted" },
    ]);
    expect(requests).toHaveLength(1);
    const body = JSON.parse(requests[0].body as string);
    expect(body).toMatchObject({ syncId: "sync1", runId: "run1", sentAt: "2026-10-05T10:00:00.000Z" });
    expect(body.records).toEqual([
      expect.objectContaining({ operation: "upsert", key: "k0", data: { id: 0, name: "n0" } }),
      expect.objectContaining({ operation: "upsert", key: "k1", data: { id: 1, name: "n1" } }),
    ]);
    expect(requests[0].headers!["content-type"]).toBe("application/json");
    expect(requests[0].headers!["idempotency-key"]).toBeUndefined();
  });

  it("sends an Idempotency-Key header for single-record requests", async () => {
    const { promise, requests } = deliver([200]);
    await promise;
    const body = JSON.parse(requests[0].body as string);
    expect(requests[0].headers!["idempotency-key"]).toBe(body.records[0].idempotencyKey);
  });

  it("idempotency key is stable across runs and changes with content, key and operation", () => {
    const base = idempotencyKey("s", "k", "upsert", { a: 1 });
    expect(idempotencyKey("s", "k", "upsert", { a: 1 })).toBe(base);
    expect(idempotencyKey("s", "k", "upsert", { a: 2 })).not.toBe(base);
    expect(idempotencyKey("s", "k2", "upsert", { a: 1 })).not.toBe(base);
    expect(idempotencyKey("s", "k", "delete", { a: 1 })).not.toBe(base);
    expect(idempotencyKey("s2", "k", "upsert", { a: 1 })).not.toBe(base);
  });

  it("splits into requests of recordsPerRequest and keeps outcome order", async () => {
    const { promise, requests } = deliver([200], records(5), { recordsPerRequest: 2, concurrency: 1 });
    const outcomes = await promise;
    expect(requests.map(r => JSON.parse(r.body as string).records.length)).toEqual([2, 2, 1]);
    expect(outcomes.map(o => o.operationId)).toEqual(["op0", "op1", "op2", "op3", "op4"]);
  });

  it("never exceeds the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const deps: DeliveryDeps = {
      send: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight--;
        return { status: 200, truncated: false };
      },
      sleep: async () => {},
      now: () => new Date(),
    };
    await deliverBatch({
      records: records(10),
      action: "upsert",
      scope,
      config: config(),
      options: parsedOptions({ recordsPerRequest: 1, concurrency: 3 }),
      signal: new AbortController().signal,
      deps,
    });
    expect(peak).toBe(3);
  });

  it("retries 5xx with backoff and then accepts", async () => {
    const { promise, requests, sleeps } = deliver([503, 502, 200]);
    expect((await promise)[0].status).toBe("accepted");
    expect(requests).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("honours Retry-After, capped at 30 seconds", async () => {
    const a = deliver([{ status: 429, retryAfter: "7" }, 200]);
    await a.promise;
    expect(a.sleeps).toEqual([7000]);
    const b = deliver([{ status: 429, retryAfter: "3600" }, 200]);
    await b.promise;
    expect(b.sleeps).toEqual([30000]);
  });

  it("rejects after retries are exhausted, with the last status as code", async () => {
    const { promise, requests } = deliver([500]);
    expect(await promise).toEqual([
      { operationId: "op0", status: "rejected", code: "http_500", safeReason: "HTTP 500" },
    ]);
    expect(requests).toHaveLength(4);
  });

  it("rejects 4xx immediately without retrying", async () => {
    const { promise, requests } = deliver([400]);
    expect((await promise)[0]).toMatchObject({ status: "rejected", code: "http_400" });
    expect(requests).toHaveLength(1);
  });

  it("does not follow redirects: 3xx is rejected", async () => {
    const { promise, requests } = deliver([302]);
    expect((await promise)[0]).toMatchObject({ status: "rejected", code: "redirect_refused" });
    expect(requests).toHaveLength(1);
  });

  it("an ambiguous failure after connect is retried and reported as unconfirmed, never accepted", async () => {
    const { promise, requests } = deliver([new GuardedRequestError("timeout", true)]);
    expect((await promise)[0]).toMatchObject({ status: "rejected", code: "unconfirmed" });
    expect(requests).toHaveLength(4);
  });

  it("a failure before connect keeps its own code", async () => {
    const { promise } = deliver([new GuardedRequestError("dns_error", false)]);
    expect((await promise)[0]).toMatchObject({ status: "rejected", code: "dns_error" });
  });

  it("blocked addresses and TLS errors are not retried", async () => {
    for (const code of ["blocked_address", "tls_error"] as const) {
      const { promise, requests } = deliver([new GuardedRequestError(code, false)]);
      expect((await promise)[0]).toMatchObject({ status: "rejected", code });
      expect(requests).toHaveLength(1);
    }
  });

  it("an unexpected error becomes a rejected outcome, not a throw", async () => {
    const fake = fakeDeps([200]);
    fake.deps.send = async () => {
      throw new Error("boom with secret https://x?token=abc");
    };
    const outcomes = await deliverBatch({
      records: records(1),
      action: "upsert",
      scope,
      config: config(),
      options: parsedOptions(),
      signal: new AbortController().signal,
      deps: fake.deps,
    });
    expect(outcomes[0]).toMatchObject({ status: "rejected", code: "internal_error" });
    expect(JSON.stringify(outcomes)).not.toContain("secret");
  });

  it("an abort propagates instead of becoming an outcome", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = fakeDeps([new GuardedRequestError("aborted", false)]);
    await expect(
      deliverBatch({
        records: records(1),
        action: "upsert",
        scope,
        config: config(),
        options: parsedOptions(),
        signal: controller.signal,
        deps: fake.deps,
      })
    ).rejects.toBeInstanceOf(GuardedRequestError);
  });

  it("sends configured headers and a delete operation for remove", async () => {
    const fake = fakeDeps([200]);
    await deliverBatch({
      records: records(1),
      action: "delete",
      scope,
      config: config({ headers: ["Authorization: Bearer a:b"] }),
      options: parsedOptions(),
      signal: new AbortController().signal,
      deps: fake.deps,
    });
    expect(fake.requests[0].headers!.Authorization).toBe("Bearer a:b");
    expect(JSON.parse(fake.requests[0].body as string).records[0].operation).toBe("delete");
  });

  it("signs the body with HMAC", async () => {
    const { promise, requests } = deliver(
      [200],
      records(1),
      {},
      { signatureMethod: "hmac", signatureSecret: "s3cret" }
    );
    await promise;
    const headers = requests[0].headers!;
    const ts = headers["Jitsu-Signature-Timestamp"];
    const expected = createHmac("sha256", "s3cret").update(`${ts}.${requests[0].body}`).digest("hex");
    expect(headers["Jitsu-Signature"]).toBe(expected);
  });
});

describe("request size cap", () => {
  const big = (i: number, kb: number) => ({
    operationId: `op${i}`,
    key: `k${i}`,
    row: { id: i, blob: "x".repeat(kb * 1024) },
  });

  it("packs records by size so no request body exceeds the cap", async () => {
    const recs = Array.from({ length: 10 }, (_, i) => big(i, 300));
    const { promise, requests } = deliver([200], recs, { recordsPerRequest: 200, concurrency: 1 });
    const outcomes = await promise;
    expect(outcomes.every(o => o.status === "accepted")).toBe(true);
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests)
      expect(Buffer.byteLength(request.body as string)).toBeLessThanOrEqual(maxRequestBytes);
    const sent = requests.flatMap(r => JSON.parse(r.body as string).records.map((x: any) => x.key));
    expect(sent).toEqual(recs.map(r => r.key));
  });

  it("a record that cannot fit alone is rejected as request_too_large and nothing else is affected", async () => {
    const recs = [big(0, 1), big(1, 1200), big(2, 1)];
    const { promise, requests } = deliver([200], recs, { recordsPerRequest: 200, concurrency: 1 });
    const outcomes = await promise;
    expect(outcomes.map(o => o.status)).toEqual(["accepted", "rejected", "accepted"]);
    expect(outcomes[1]).toMatchObject({ code: "request_too_large" });
    expect(JSON.stringify(outcomes)).not.toContain("xxxx");
    for (const request of requests)
      expect(Buffer.byteLength(request.body as string)).toBeLessThanOrEqual(maxRequestBytes);
    expect(requests.flatMap(r => JSON.parse(r.body as string).records.map((x: any) => x.key))).not.toContain("k1");
  });
});

describe("signing", () => {
  it("Ed25519 signatures verify with the public key, from PEM or bare base64", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const bare = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    for (const key of [pem, bare]) {
      const headers = signatureHeaders(
        "body",
        { method: "ed25519", privateKey: key, header: "X-Sig", includeTimestamp: true },
        1000
      );
      expect(headers["X-Sig-Timestamp"]).toBe("1000");
      expect(verify(null, Buffer.from("1000.body"), publicKey, Buffer.from(headers["X-Sig"], "hex"))).toBe(true);
    }
  });

  it("omits the timestamp when disabled and signs only the body", () => {
    const headers = signatureHeaders("b", { method: "hmac", secret: "k", header: "H", includeTimestamp: false });
    expect(Object.keys(headers)).toEqual(["H"]);
    expect(headers.H).toBe(createHmac("sha256", "k").update("b").digest("hex"));
  });

  it("a bad key fails without leaking key material", () => {
    expect(() =>
      signatureHeaders("b", {
        method: "ed25519",
        privateKey: "not-a-key-SECRETVALUE",
        header: "H",
        includeTimestamp: true,
      })
    ).toThrowError(/^Webhook signing failed$/);
  });

  it("method none adds nothing", () => {
    expect(signatureHeaders("b", { method: "none", header: "H", includeTimestamp: true })).toEqual({});
  });
});

describe("webhook validation", () => {
  const valid = {
    stream: "rows",
    mode: "upsert" as const,
    streamOptions: options,
    mapping: { id: "id", name: "name" },
  };
  const model = { primaryKey: ["id"] };

  it("accepts a valid https setup", () => {
    expect(() => validateWebhookReverseSettings(valid, model, destination)).not.toThrow();
  });

  it("requires the delivery attestation", () => {
    expect(() => validateWebhookReverseSettings({ ...valid, streamOptions: {} }, model, destination)).toThrow();
    expect(() =>
      validateWebhookReverseSettings({ ...valid, streamOptions: { deliveryAttested: false } }, model, destination)
    ).toThrow();
  });

  it("requires acknowledgement for http and accepts it when given", () => {
    const http = { ...destination, url: "http://example.com/hook" };
    expect(() => validateWebhookReverseSettings(valid, model, http)).toThrow(/unencrypted/);
    expect(() =>
      validateWebhookReverseSettings({ ...valid, streamOptions: { ...options, allowInsecureHttp: true } }, model, http)
    ).not.toThrow();
  });

  it("rejects non-POST, bad schemes, embedded credentials and mirror mode", () => {
    expect(() => validateWebhookReverseSettings(valid, model, { ...destination, method: "PUT" })).toThrow(/POST/);
    expect(() => validateWebhookReverseSettings(valid, model, { ...destination, url: "ftp://x/y" })).toThrow(
      WebhookConfigError
    );
    expect(() => validateWebhookReverseSettings(valid, model, { ...destination, url: "https://u:p@x/y" })).toThrow(
      /username/
    );
    expect(() => validateWebhookReverseSettings({ ...valid, mode: "mirror" }, model, destination)).toThrow(/mirror/);
  });

  it("rejects reserved and malformed headers", () => {
    for (const header of ["Host: x", "jitsu-foo: 1", "Content-Type: x", "no colon", "Bad Name: 1", "X: a\nb"]) {
      expect(() => validateWebhookDestination({ ...destination, headers: [header] }), header).toThrow(
        WebhookConfigError
      );
    }
  });

  describe("signature header names", () => {
    const signed = (extra: object) =>
      validateWebhookDestination({ ...destination, signatureMethod: "hmac", signatureSecret: "k", ...extra });
    const reserved = [
      "Host",
      "Content-Length",
      "Content-Type",
      "Content-Encoding",
      "Transfer-Encoding",
      "Connection",
      "User-Agent",
      "Idempotency-Key",
    ];

    it("rejects the names Jitsu or the transport own, in any letter case, when signing is on", () => {
      for (const name of reserved) {
        for (const variant of [name, name.toLowerCase(), name.toUpperCase()]) {
          expect(() => signed({ signatureHeader: variant }), variant).toThrow(WebhookConfigError);
          expect(() => signed({ signatureHeader: variant }), variant).toThrow(/set by Jitsu|cannot be used/);
        }
      }
    });

    it("rejects a signature header that is also one of the destination's own headers", () => {
      expect(() => signed({ signatureHeader: "X-Auth", headers: ["x-auth: token"] })).toThrow(/also listed/);
    });

    it("rejects a name whose timestamp companion would collide", () => {
      expect(() => signed({ signatureHeader: "X-Sig", headers: ["X-Sig-Timestamp: 1"] })).toThrow(/also listed/);
      // without the timestamp there is no companion header
      expect(() =>
        signed({ signatureHeader: "X-Sig", headers: ["X-Sig-Timestamp: 1"], signatureIncludeTimestamp: false })
      ).not.toThrow();
    });

    it("accepts the default and ordinary custom names", () => {
      expect(() => signed({})).not.toThrow();
      expect(() => signed({ signatureHeader: "X-My-Signature" })).not.toThrow();
      expect(() => signed({ signatureHeader: "Jitsu-Signature" })).not.toThrow();
    });

    it("ignores the name when signing is off, because no signature header is sent", () => {
      expect(() => validateWebhookDestination({ ...destination, signatureHeader: "Content-Length" })).not.toThrow();
    });

    it("is enforced when the runtime binds the saved destination, not only at save time", () => {
      expect(() =>
        createWebhookRuntime(
          {
            destination: {
              ...destination,
              signatureMethod: "hmac",
              signatureSecret: "k",
              signatureHeader: "Content-Length",
            },
            options: { stream: "rows", mode: "upsert", streamOptions: options },
            model: { primaryKey: ["id"] },
          } as any,
          undefined
        )
      ).toThrow(/misconfigured|destination/i);
    });
  });

  it("requires signing material for the chosen method", () => {
    expect(() => validateWebhookDestination({ ...destination, signatureMethod: "hmac" })).toThrow(/secret/);
    expect(() => validateWebhookDestination({ ...destination, signatureMethod: "ed25519" })).toThrow(/private key/);
  });

  it("requires primary key columns in the mapping and valid field names", () => {
    expect(() => validateWebhookReverseSettings(valid, { primaryKey: ["missing"] }, destination)).toThrow(
      /primary key/
    );
    expect(() =>
      validateWebhookReverseSettings({ ...valid, mapping: { "a-b": "a-b", id: "id" } }, model, destination)
    ).toThrow(/field name/);
    expect(() =>
      validateWebhookReverseSettings({ ...valid, mapping: { x: "y", id: "id" } }, model, destination)
    ).toThrow(/own names/);
  });
});

describe("row normalisation", () => {
  it("makes warehouse values plain JSON", () => {
    expect(normalizeRowValue(10n)).toBe("10");
    expect(normalizeRowValue(NaN)).toBe("NaN");
    expect(normalizeRowValue(-Infinity)).toBe("-Infinity");
    expect(normalizeRowValue(undefined)).toBeNull();
    expect(normalizeRowValue(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(normalizeRowValue(new Uint8Array([1, 2, 3]))).toBe("AQID");
    expect(normalizeRowValue({ a: [1n, { b: undefined }] })).toEqual({ a: ["1", { b: null }] });
  });
});

describe("runtime adapter", () => {
  const base = {
    id: "sync1",
    workspaceId: "w",
    toId: "d",
    destination,
    model: { primaryKey: ["id"] },
    options: { stream: "rows", mode: "upsert" as const, streamOptions: options, mapping: { id: "id" } },
  } as any;

  it("is registered for webhook", () => {
    expect(reverseDestinationRuntime.get("webhook")?.create).toBe(createWebhookRuntime);
  });

  it("identity comes from the primary key, so an updated row keeps its identity", () => {
    const adapter = createWebhookRuntime(base);
    const a = adapter.project("upsert", { id: 1, name: "a" } as any);
    const b = adapter.project("upsert", { id: 1, name: "changed" } as any);
    const c = adapter.project("upsert", { id: 2, name: "a" } as any);
    expect(a[0].identity).toBe(b[0].identity);
    expect(a[0].identity).not.toBe(c[0].identity);
  });

  it("targetIdentity names the destination without being a secret-bearing log line", () => {
    expect(createWebhookRuntime(base).targetIdentity).toBe("webhook:POST:https://example.com/hook");
  });

  it("refuses a model without a primary key, non-upsert mode and unattested settings", () => {
    expect(() => createWebhookRuntime({ ...base, model: {} })).toThrow(/sync settings/);
    expect(() => createWebhookRuntime({ ...base, options: { ...base.options, mode: "mirror" } })).toThrow(
      /sync settings/
    );
    expect(() => createWebhookRuntime({ ...base, options: { ...base.options, streamOptions: {} } })).toThrow(
      /sync settings/
    );
    expect(() => createWebhookRuntime({ ...base, destination: { ...destination, method: "PUT" } })).toThrow(
      /destination configuration/
    );
  });

  const ctx = (deps: DeliveryDeps) =>
    ({
      syncId: "sync1",
      logicalRunId: "run1",
      credentials: destination,
      options,
      signal: new AbortController().signal,
    } as any);

  it("writer turns failures into rejected outcomes instead of throwing", async () => {
    const { deps } = fakeDeps([500]);
    const writer = createWebhookWriter(ctx(deps), deps);
    const result = await writer.upsert({ records: records(2) } as any);
    expect(result.outcomes.map(o => o.status)).toEqual(["rejected", "rejected"]);
  });

  it("recovery re-sends only records the saved receipt does not show as accepted", async () => {
    const { deps, requests } = fakeDeps([200]);
    const recovery = webhookRecovery(deps);
    const result = await recovery.reconcileBatch!(
      { records: records(3) } as any,
      "upsert",
      { outcomes: [{ operationId: "op0", status: "accepted" }] } as any,
      ctx(deps)
    );
    const sent = JSON.parse(requests[0].body as string).records.map((r: any) => r.key);
    expect(sent).toEqual(["k1", "k2"]);
    expect(result.outcomes.map(o => o.status)).toEqual(["accepted", "accepted", "accepted"]);
  });

  it("recovery reports a still-failing re-send as rejected, never accepted", async () => {
    const { deps } = fakeDeps([new GuardedRequestError("timeout", true)]);
    const result = await webhookRecovery(deps).reconcileBatch!(
      { records: records(1) } as any,
      "upsert",
      undefined,
      ctx(deps)
    );
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", code: "unconfirmed" });
  });
});

describe("failure messages", () => {
  it("maps both webhook init errors to a user-readable message", async () => {
    const { reverseEtlFailure } = await import("../src/reverse-etl/failure");
    for (const reason of ["Webhook destination configuration is invalid", "Webhook sync settings are invalid"]) {
      const failure = reverseEtlFailure(new Error(reason));
      expect(failure?.reason).toBe(reason);
      expect(failure?.message).toMatch(/destination|sync/i);
    }
  });
});
