import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signFunctionsRequest, verifyFunctionsRequest } from "../src/functions-auth";

const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const now = 1793026000000;
const url = "http://fs-free-1:3456/multi?ids=connection-1&fullEvents=true";
const body = '{"workspaceId":"tenant-1","event":{"type":"track","event":"日本語"}}';
const bytes = Buffer.from(body);
const headers = signFunctionsRequest(privateKey, "free-1", url, body, now);
const request = () => new Request(url, { method: "POST", headers });

describe("functions request authentication", () => {
  it("accepts an authentic request with the exact wire body", () => {
    expect(verifyFunctionsRequest(publicKey, "free-1", request(), bytes, now)).toBe(true);
  });
  it.each([
    "body",
    "deployment",
    "method",
    "path",
    "query",
    "signature",
    "expired",
    "future",
    "missing-key",
    "invalid-key",
  ])("rejects %s tampering", change => {
    let req = request();
    if (change === "method") req = new Request(url, { method: "DELETE", headers });
    if (change === "path") req = new Request(url.replace("/multi", "/udfrun"), { method: "POST", headers });
    if (change === "query") req = new Request(url.replace("connection-1", "connection-2"), { method: "POST", headers });
    if (change === "signature") req.headers.set("x-jitsu-request-signature", "A".repeat(86) + "==");
    expect(
      verifyFunctionsRequest(
        change === "missing-key" ? undefined : change === "invalid-key" ? "invalid" : publicKey,
        change === "deployment" ? "other-tenant" : "free-1",
        req,
        change === "body" ? Buffer.from(body.replace("tenant-1", "tenant-2")) : bytes,
        now + (change === "expired" ? 60001 : change === "future" ? -60001 : 0)
      )
    ).toBe(false);
  });
  it("rejects unsigned calls", () => {
    expect(verifyFunctionsRequest(publicKey, "free-1", new Request(url, { method: "POST" }), bytes, now)).toBe(false);
  });
  it("fails closed when the caller has no key or deployment", () => {
    expect(() => signFunctionsRequest(undefined, "free-1", url, body)).toThrow("not configured");
    expect(() => signFunctionsRequest(privateKey, "", url, body)).toThrow("not configured");
  });
});
