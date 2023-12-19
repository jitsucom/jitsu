import { NextApiRequest } from "next";
import { getErrorMessage } from "juava";
import { IngestType } from "@jitsu/protocols/async-request";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { getServerLog } from "./server/log";
import { mainDataDomain } from "./server/data-domains";

export type HttpProtocolVariant = "https" | "http";

export const log = getServerLog("domains");

export type PublicEndpoint = {
  //always without port
  hostname: string;
  protocol: HttpProtocolVariant;
  isDefaultPort: boolean;
  //if protocol matches
  port: number;
  baseUrl: string;
};

export type StreamCredentials = { domain?: string; slug?: string; writeKey?: string; ingestType: IngestType };

/**
 * Example:
 *  * https://analytics.mydomain.com -> {domain: "analytics.mydomain.com"}
 *  * https://<stream_id>.d.jitsu.dev -> {slug: "<stream_id>"}
 * @param req
 * @param keyType type of a key
 */
export function getDataLocator(
  req: NextApiRequest,
  ingestType: IngestType,
  event: AnalyticsServerEvent
): StreamCredentials {
  const requestEndpoint = getReqEndpoint(req);
  const [dataHost] = mainDataDomain?.split(":") || [undefined]; //ignore port, port can be used only in dev env
  const loc: Partial<StreamCredentials> = { ingestType };
  if (req.headers["authorization"]) {
    const auth = Buffer.from(req.headers["authorization"].replace("Basic ", ""), "base64").toString("utf-8");
    loc.writeKey = auth;
  } else if (req.headers["x-write-key"]) {
    loc.writeKey = req.headers["x-write-key"] as string;
  }
  if (dataHost && requestEndpoint.hostname.endsWith(`.${dataHost}`)) {
    loc.slug = requestEndpoint.hostname.replace(`.${dataHost}`, "");
  } else {
    loc.domain = requestEndpoint.hostname;
  }
  return loc as StreamCredentials;
}

export function getDefaultPort(protocol: HttpProtocolVariant) {
  return protocol === "https" ? 443 : 80;
}

export function getAppEndpoint(req: NextApiRequest): PublicEndpoint {
  let envUrl = process.env.JITSU_PUBLIC_URL || process.env.VERCEL_URL;
  if (envUrl) {
    if (envUrl.indexOf("https://") !== 0 && envUrl.indexOf("http://") !== 0) {
      envUrl = "https://" + envUrl;
    }
    let publicUrl: URL;
    try {
      publicUrl = new URL(envUrl);
      const protocol = (publicUrl.protocol ? publicUrl.protocol : "https").replace(":", "") as HttpProtocolVariant;
      const port = publicUrl.port ? parseInt(publicUrl.port) : getDefaultPort(protocol);

      return {
        hostname: publicUrl.hostname,
        protocol,
        port,
        baseUrl: envUrl,
        isDefaultPort: port === getDefaultPort(protocol),
      };
    } catch (e) {
      log
        .atError()
        .withCause(e)
        .log(
          `Can't parse url ${envUrl}. JITSU_PUBLIC_URL=${process.env.JITSU_PUBLIC_URL}. VERCEL_URL=${
            process.env.VERCEL_URL
          }: ${getErrorMessage(e)}`
        );
    }
  }
  return getReqEndpoint(req);
}

export function getReqEndpoint(req: NextApiRequest): PublicEndpoint {
  const [hostname, maybePort] = ((req.headers["x-forwarded-host"] || req.headers.host) as string).split(":");
  const protocol = ((req.headers["x-forwarded-proto"] as string) || "http") as HttpProtocolVariant;

  const defaultPort = getDefaultPort(protocol);
  const port = maybePort ? parseInt(maybePort) : defaultPort;
  const isDefaultPort = port === defaultPort;
  const baseUrl = `${protocol}://${hostname}${isDefaultPort ? "" : ":" + port}`;
  return {
    hostname,
    protocol,
    isDefaultPort,
    port,
    baseUrl,
  };
}
