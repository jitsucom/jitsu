import { createHash, sign, verify } from "node:crypto";

const timestampHeader = "x-jitsu-request-timestamp";
const signatureHeader = "x-jitsu-request-signature";
const maxAgeMs = 60_000;

function signedMessage(method: string, url: string, deploymentId: string, timestamp: string, body: Uint8Array) {
  const parsed = new URL(url);
  return Buffer.from(
    [
      "jitsu-functions-v1",
      method.toUpperCase(),
      parsed.pathname + parsed.search,
      deploymentId,
      timestamp,
      createHash("sha256").update(body).digest("hex"),
    ].join("\n")
  );
}

/** Only trusted callers hold the private key; function runtimes receive the public key. */
export function signFunctionsRequest(
  privateKey: string | undefined,
  deploymentId: string,
  url: string,
  body: string,
  now = Date.now()
): Record<string, string> {
  if (!privateKey || !deploymentId) throw new Error("Functions request signing is not configured");
  const timestamp = String(now);
  const signature = sign(null, signedMessage("POST", url, deploymentId, timestamp, Buffer.from(body)), privateKey);
  return { [timestampHeader]: timestamp, [signatureHeader]: signature.toString("base64") };
}

export function verifyFunctionsRequest(
  publicKey: string | undefined,
  deploymentId: string,
  request: Request,
  body: Uint8Array,
  now = Date.now()
): boolean {
  if (!publicKey || !deploymentId) return false;
  const timestamp = request.headers.get(timestampHeader) ?? "";
  const signature = request.headers.get(signatureHeader) ?? "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > maxAgeMs) return false;
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  try {
    return verify(
      null,
      signedMessage(request.method, request.url, deploymentId, timestamp, body),
      publicKey,
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}
