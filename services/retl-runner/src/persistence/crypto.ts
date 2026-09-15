import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { canonicalJson } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { ensure, PersistenceError } from "./types";

/** Base64 plus worst-case envelope overhead, including any supported rotation key ID. */
export function encryptedByteBudget(plaintextBytes: number): number {
  return 4 * Math.ceil(plaintextBytes / 3) + 256;
}

/** Random nonce, authenticated scope binding and key ID for rotation. Keys never enter SQL. */
export class Cipher {
  private readonly keys: Map<string, Buffer>;
  constructor(private readonly activeKey: string, keys: Record<string, Buffer>) {
    this.keys = new Map(Object.entries(keys).map(([id, key]) => [id, Buffer.from(key)]));
    ensure(this.keys.has(activeKey), "Missing active encryption key");
    for (const [id, key] of this.keys)
      ensure(/^[a-zA-Z0-9_-]{1,64}$/.test(id) && key.length === 32, "Invalid encryption key");
  }
  seal(value: unknown, aad: string, maxBytes: number): Buffer {
    const plaintext = Buffer.from(canonicalJson(value));
    ensure(plaintext.length <= maxBytes, "Encrypted value exceeds its byte budget");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.activeKey)!, nonce);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.from(
      JSON.stringify({
        key: this.activeKey,
        nonce: nonce.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: ciphertext.toString("base64"),
      })
    );
  }
  open<T>(encrypted: Buffer, aad: string): T {
    try {
      const envelope = JSON.parse(encrypted.toString());
      const key = this.keys.get(envelope.key);
      ensure(key, "Encryption key unavailable");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      return JSON.parse(
        Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString()
      );
    } catch {
      throw new PersistenceError("Recovery data could not be decrypted");
    }
  }
}
