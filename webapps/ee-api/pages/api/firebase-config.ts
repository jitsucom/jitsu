import { withErrorHandler } from "../../lib/route-helpers";
import { getFirebaseOptions, isFirebaseEnabled } from "../../lib/firebase-auth";

/**
 * Public Firebase client config for the browser SDK. The Firebase web config
 * (apiKey, authDomain, …) is not secret — it's meant to ship to the client.
 * The admin service-account half of `FIREBASE_AUTH` is never exposed here.
 */
export default withErrorHandler(async () => {
  if (!isFirebaseEnabled()) {
    return { enabled: false };
  }
  return { enabled: true, config: getFirebaseOptions()?.client ?? null };
});
