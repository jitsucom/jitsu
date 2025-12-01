import { Simplify } from "type-fest";
import { requireDefined } from "juava";
import { getServerEnv } from "../serverEnv";

export type NangoParams = {
  callback: string;
  secretKey: string;
  publicKey: string;
  nangoAppHost: string;
  nangoApiHost: string;
};

export type NangoConfig = Simplify<
  ({ enabled: false } & { [k in keyof NangoParams]?: never }) | ({ enabled: true } & NangoParams)
>;

function getNangoConfig(): NangoConfig {
  const serverEnv = getServerEnv();
  if (!serverEnv.NANGO_APP_HOST) {
    return { enabled: false };
  }
  return {
    enabled: true,
    nangoAppHost: serverEnv.NANGO_APP_HOST,
    nangoApiHost: requireDefined(serverEnv.NANGO_API_HOST, `env NANGO_API_HOST is required`),
    secretKey: requireDefined(serverEnv.NANGO_SECRET_KEY, `env NANGO_SECRET_KEY is required`),
    publicKey: requireDefined(serverEnv.NANGO_PUBLIC_KEY, `env NANGO_SECRET_KEY is required`),
    callback: serverEnv.NANGO_CALLBACK || `${serverEnv.NANGO_HOST}/oauth/callback`,
  };
}

export const nangoConfig: NangoConfig = getNangoConfig();
