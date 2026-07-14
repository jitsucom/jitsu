import { randomId } from "juava";
import type { KvStore } from "../kv";

const PREFIX = "oauth:code:";
const TTL_MS = 60 * 1000;

export type CodePayload = {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string; // PKCE S256 challenge from the authorize request
  codeChallengeMethod: "S256"; // we don't accept "plain"
  createdAt: number;
};

// One-shot OAuth authorization codes. The KV's atomic `getDel` is what makes
// consumption safe: two concurrent /oauth/token requests for the same code
// will see at most one row, so a code can never be exchanged twice.
export class OAuthCodesRepo {
  constructor(private readonly kv: KvStore) {}

  async issueCode(payload: Omit<CodePayload, "createdAt">): Promise<string> {
    const code = randomId({ digits: 48, strongRandom: true });
    await this.kv.set(PREFIX + code, { ...payload, createdAt: Date.now() } satisfies CodePayload, {
      ttlMs: TTL_MS,
    });
    return code;
  }

  async consumeCode(code: string): Promise<CodePayload | undefined> {
    return this.kv.getDel<CodePayload>(PREFIX + code);
  }
}
