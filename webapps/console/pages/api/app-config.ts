import { createRoute } from "../../lib/api";
import { AppConfig } from "../../lib/schema";
import { getAppEndpoint } from "../../lib/domains";
import { getEeConnection, isEEAvailable } from "../../lib/server/ee";
import { isFirebaseEnabled, requireFirebaseOptions } from "../../lib/server/firebase-server";
import { nangoConfig } from "../../lib/server/oauth/nango-config";
import { getPublicMaintenanceState } from "../../lib/server/maintenance";
import { productTelemetryEnabled, productTelemetryHost } from "../../lib/server/telemetry";
import { mainDataDomain } from "../../lib/server/data-domains";
import { customDomainCnames } from "../../lib/server/custom-domains";
import { credentialsLoginEnabled, githubLoginEnabled, oidcLoginEnabled } from "../../lib/nextauth.config";
import { getServerEnv } from "../../lib/server/serverEnv";

function isSignupDisabled() {
  const serverEnv = getServerEnv();
  return (
    serverEnv.DISABLE_SIGNUP || //explicitly disabled
    // Signup needs a provider that supports it: Firebase (Cloud), GitHub, or
    // OIDC. Credentials signup isn't supported. Firebase was missing here, so a
    // Firebase-only deployment hid the signup link (prod only worked because it
    // also sets GITHUB_CLIENT_ID).
    (!isFirebaseEnabled() && !githubLoginEnabled && !oidcLoginEnabled)
  );
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
    // `appConfig.ee.available` advertises ee-api to the browser. Browser→ee-api
    // calls authenticate with a Firebase ID token (`x-fb-auth`) — see
    // `lib/eeApi.ts`. A deployment that has `EE_CONNECTION` set but Firebase
    // disabled (self-hosted EE with NextAuth/OIDC) cannot serve those calls,
    // so we advertise `available = false` there. Callers that check this flag
    // (S3 init, billing UI, EE-flavored UI hints) skip cleanly. Server-side
    // code keeps using `isEEAvailable()` directly + the service token for
    // its own console→ee-api calls; that path doesn't go through app-config.
    const eeBrowserAvailable = isEEAvailable() && isFirebaseEnabled();
    return {
      docsUrl: serverEnv.JITSU_DOCUMENTATION_URL || "https://docs.jitsu.com/",
      maintenance: getPublicMaintenanceState(),
      ee: {
        available: eeBrowserAvailable,
        host: eeBrowserAvailable ? getEeConnection().host : undefined,
      },
      disableSignup: isSignupDisabled(),
      // Display-only hint for the signup form (JITSU-70). Enforcement stays
      // server-side; the browser never gets the personal-domain list.
      limitPersonalEmails: serverEnv.LIMIT_PERSONAL_EMAILS,
      auth,
      billingEnabled: eeBrowserAvailable,
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
