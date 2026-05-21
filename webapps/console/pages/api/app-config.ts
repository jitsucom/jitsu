import { createRoute } from "../../lib/api";
import { AppConfig } from "../../lib/schema";
import { getAppEndpoint } from "../../lib/domains";
import { getEeConnection, isEEAvailable } from "../../lib/server/ee";
import { isFirebaseEnabled, requireFirebaseOptions } from "../../lib/server/firebase-server";
import { nangoConfig } from "../../lib/server/oauth/nango-config";
import { readOnlyUntil } from "../../lib/server/read-only-mode";
import { productTelemetryEnabled, productTelemetryHost } from "../../lib/server/telemetry";
import { mainDataDomain } from "../../lib/server/data-domains";
import { customDomainCnames } from "../../lib/server/custom-domains";
import { credentialsLoginEnabled, githubLoginEnabled, oidcLoginEnabled } from "../../lib/nextauth.config";
import { getServerEnv } from "../../lib/server/serverEnv";

function isSignupDisabled() {
  const serverEnv = getServerEnv();
  return (
    serverEnv.DISABLE_SIGNUP || //explicitly disabled
    (!githubLoginEnabled && !oidcLoginEnabled)
  ); // we don't support credentials signup yet ;
}

export default createRoute()
  .GET({ result: AppConfig, auth: false })
  .handler(async ({ req }) => {
    const serverEnv = getServerEnv();
    const publicEndpoints = getAppEndpoint(req);
    const dataHost = mainDataDomain;
    const ingestUrl = serverEnv.JITSU_INGEST_PUBLIC_URL;
    const nextAuth = credentialsLoginEnabled || githubLoginEnabled || oidcLoginEnabled;
    const auth = {
      ...(isFirebaseEnabled()
        ? {
            firebasePublic: requireFirebaseOptions().client,
          }
        : {}),
      ...(nextAuth
        ? {
            nextauth: {
              github: githubLoginEnabled,
              oidc: oidcLoginEnabled,
              credentials: credentialsLoginEnabled,
            },
          }
        : {}),
      dynamicOidc: serverEnv.DYNAMIC_OIDC_ENABLED,
    };
    return {
      docsUrl: serverEnv.JITSU_DOCUMENTATION_URL || "https://docs.jitsu.com/",
      readOnlyUntil: readOnlyUntil?.toISOString(),
      ee: {
        available: isEEAvailable(),
        host: isEEAvailable() ? getEeConnection().host : undefined,
      },
      disableSignup: isSignupDisabled(),
      auth,
      billingEnabled: isEEAvailable(),
      customDomainsEnabled: customDomainCnames && customDomainCnames.length > 0,
      syncs: {
        enabled: serverEnv.SYNCS_ENABLED,
        scheduler: {
          // Scheduling is now handled by syncctl (in-cluster) — gate the
          // schedule UI on the presence of a syncctl endpoint.
          enabled: !!serverEnv.SYNCCTL_URL,
        },
      },
      frontendTelemetry: {
        enabled: productTelemetryEnabled,
        host: productTelemetryHost === "__self__" ? publicEndpoints.baseUrl : productTelemetryHost,
      },
      publicEndpoints: {
        protocol: publicEndpoints.protocol,
        host: publicEndpoints.hostname,
        cname: serverEnv.CNAME || "cname.jitsu.com",
        dataHost,
        ingestUrl,
        port: publicEndpoints.isDefaultPort ? undefined : publicEndpoints.port,
      },
      logLevel: (serverEnv.FRONTEND_LOG_LEVEL || serverEnv.LOG_LEVEL || "info") as any,
      nango: nangoConfig.enabled
        ? {
            publicKey: nangoConfig.publicKey,
            host: nangoConfig.nangoApiHost,
          }
        : undefined,
      mitCompliant: serverEnv.MIT_COMPLIANT,
    };
  })
  .toNextApiHandler();
