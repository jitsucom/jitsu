import { createHmac, createPrivateKey, sign } from "node:crypto";

export interface SigningConfig {
  method: "none" | "hmac" | "ed25519";
  secret?: string;
  privateKey?: string;
  header: string;
  includeTimestamp: boolean;
}

// Accepts an Ed25519 private key as full PEM or as the bare base64 PKCS#8 body (with any surrounding whitespace).
function toPrivateKeyPem(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed;
  const body =
    trimmed
      .replace(/\s+/g, "")
      .match(/.{1,64}/g)
      ?.join("\n") ?? trimmed;
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

/**
 * Signature headers for a request body, in the same format the event Webhook destination uses: the signature covers
 * `<timestamp>.<body>` (or just the body when the timestamp is off) and the timestamp is sent as `<header>-Timestamp`.
 * Throws a plain error with no key material in it when signing is misconfigured.
 */
export function signatureHeaders(
  body: string,
  config: SigningConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Record<string, string> {
  if (config.method === "none") return {};
  const timestamp = config.includeTimestamp ? String(nowSeconds) : undefined;
  const signed = timestamp ? `${timestamp}.${body}` : body;
  let value: string;
  try {
    if (config.method === "hmac") {
      if (!config.secret) throw new Error("missing secret");
      value = createHmac("sha256", config.secret).update(signed).digest("hex");
    } else {
      if (!config.privateKey) throw new Error("missing key");
      value = sign(null, Buffer.from(signed), createPrivateKey(toPrivateKeyPem(config.privateKey))).toString("hex");
    }
  } catch {
    throw new Error("Webhook signing failed");
  }
  return { [config.header]: value, ...(timestamp ? { [`${config.header}-Timestamp`]: timestamp } : {}) };
}
