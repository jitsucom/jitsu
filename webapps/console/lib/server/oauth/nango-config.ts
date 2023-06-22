import { Simplify } from "type-fest";
import { requireDefined } from "juava";

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
  if (!process.env.NANGO_APP_HOST) {
    return { enabled: false };
  }
  return {
    enabled: true,
    nangoAppHost: process.env.NANGO_APP_HOST,
    nangoApiHost: requireDefined(process.env.NANGO_API_HOST, `env NANGO_API_HOST is required`),
    secretKey: requireDefined(process.env.NANGO_SECRET_KEY, `env NANGO_SECRET_KEY is required`),
    publicKey: requireDefined(process.env.NANGO_PUBLIC_KEY, `env NANGO_SECRET_KEY is required`),
    callback: process.env.NANGO_CALLBACK || `${process.env.NANGO_HOST}/oauth/callback`,
  };
}

export const nangoConfig: NangoConfig = getNangoConfig();
