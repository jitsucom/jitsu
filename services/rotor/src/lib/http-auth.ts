import { checkHash, checkRawToken, isTruish } from "juava";

export type RotorAuthEnv = {
  ROTOR_AUTH_TOKENS?: string;
  ROTOR_RAW_AUTH_TOKENS?: string;
  ROTOR_AUTH_DISABLED?: string;
};

/**
 * Splits a comma separated list of tokens and drops the empty entries. A trailing comma would otherwise leave an empty
 * token in the list, and a request without an Authorization header (an empty token) would match it.
 */
export function tokenList(value: string | undefined): string[] {
  return (value ?? "").split(",").filter(token => token !== "");
}

/**
 * Returns an error message when rotor would be open to everyone by accident: no auth tokens are configured and
 * ROTOR_AUTH_DISABLED is not set. An empty token variable (a lost secret key, a typo in a variable name) used to switch
 * authentication off silently.
 */
export function authConfigError(env: RotorAuthEnv): string | undefined {
  if (
    tokenList(env.ROTOR_AUTH_TOKENS).length === 0 &&
    tokenList(env.ROTOR_RAW_AUTH_TOKENS).length === 0 &&
    !isTruish(env.ROTOR_AUTH_DISABLED)
  ) {
    return "No auth tokens provided: set ROTOR_AUTH_TOKENS or ROTOR_RAW_AUTH_TOKENS, or set ROTOR_AUTH_DISABLED=true to run without authentication (local development only)";
  }
  return undefined;
}

/**
 * Creates the check of a bearer token. Configured tokens are always enforced, ROTOR_AUTH_DISABLED has no effect on
 * them. Without tokens only an explicit ROTOR_AUTH_DISABLED lets a request through.
 */
export function createTokenChecker(env: RotorAuthEnv): (token: string) => boolean {
  let tokens: string[];
  let checkFunction: (hashOrPlain: string, secret: string) => boolean;
  const hashed = tokenList(env.ROTOR_AUTH_TOKENS);
  const raw = tokenList(env.ROTOR_RAW_AUTH_TOKENS);
  if (hashed.length > 0) {
    tokens = hashed;
    checkFunction = checkHash;
  } else if (raw.length > 0) {
    tokens = raw;
    checkFunction = checkRawToken;
  } else {
    const open = isTruish(env.ROTOR_AUTH_DISABLED);
    return () => open;
  }
  return token => tokens.some(hashOrPlain => checkFunction(hashOrPlain, token));
}
