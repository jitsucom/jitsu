import { checkHash, checkRawToken, isTruish } from "juava";

export type RotorAuthEnv = {
  ROTOR_AUTH_TOKENS?: string;
  ROTOR_RAW_AUTH_TOKENS?: string;
  ROTOR_AUTH_DISABLED?: string;
};

/**
 * Returns an error message when rotor would be open to everyone by accident: no auth tokens are configured and
 * ROTOR_AUTH_DISABLED is not set. An empty token variable (a lost secret key, a typo in a variable name) used to switch
 * authentication off silently.
 */
export function authConfigError(env: RotorAuthEnv): string | undefined {
  if (!env.ROTOR_AUTH_TOKENS && !env.ROTOR_RAW_AUTH_TOKENS && !isTruish(env.ROTOR_AUTH_DISABLED)) {
    return "No auth tokens provided: set ROTOR_AUTH_TOKENS or ROTOR_RAW_AUTH_TOKENS, or set ROTOR_AUTH_DISABLED=true to run without authentication (local development only)";
  }
  return undefined;
}

/**
 * Creates the check of a bearer token. Configured tokens are always enforced, ROTOR_AUTH_DISABLED has no effect on
 * them. Without tokens only an explicit ROTOR_AUTH_DISABLED lets a request through.
 */
export function createTokenChecker(env: RotorAuthEnv): (token: string) => boolean {
  let tokens: string[] = [];
  let checkFunction: (hashOrPlain: string, secret: string) => boolean = () => false;
  if (env.ROTOR_AUTH_TOKENS) {
    tokens = env.ROTOR_AUTH_TOKENS.split(",");
    checkFunction = checkHash;
  } else if (env.ROTOR_RAW_AUTH_TOKENS) {
    tokens = env.ROTOR_RAW_AUTH_TOKENS.split(",");
    checkFunction = checkRawToken;
  } else {
    const open = isTruish(env.ROTOR_AUTH_DISABLED);
    return () => open;
  }
  return token => tokens.some(hashOrPlain => checkFunction(hashOrPlain, token));
}
