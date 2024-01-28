import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServerLog } from "./lib/server/log";
import { isTruish } from "./lib/shared/chores";

const logRequests = isTruish(process.env.CONSOLE_DEBUG_REQUESTS);

function prettifyBody(body: string) {
  try {
    const obj = JSON.parse(body);
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return body;
  }
}
const segmentsSettings = (writeKey: string) => ({
  integrations: {
    "Segment.io": {
      apiKey: writeKey,
      unbundledIntegrations: [],
      addBundledMetadata: true,
      maybeBundledConfigIds: {},
      versionSettings: { version: "4.4.7", componentTypes: ["browser"] },
    },
  },
  plan: {
    track: { __default: { enabled: true, integrations: {} } },
    identify: { __default: { enabled: true } },
    group: { __default: { enabled: true } },
  },
  edgeFunction: {},
  analyticsNextEnabled: true,
  middlewareSettings: {},
  enabledMiddleware: {},
  metrics: { sampleRate: 0.1 },
  legacyVideoPluginsEnabled: false,
  remotePlugins: [],
});
const log = getServerLog("request-logger");

export async function middleware(request: NextRequest) {
  let response;
  if (request.nextUrl.pathname.startsWith("/p.js")) {
    response = NextResponse.rewrite(new URL("/api/s/javascript-library", request.url));
  } else if (request.nextUrl.pathname.startsWith("/v1/batch")) {
    response = NextResponse.rewrite(new URL("/api/s/batch", request.url));
  } else if (request.nextUrl.pathname.startsWith("/v1/b")) {
    response = NextResponse.rewrite(new URL("/api/s/batch", request.url));
  } else if (request.nextUrl.pathname.startsWith("/v1/projects")) {
    // mimic segments setting endpoint
    // https://cdn-settings.segment.com/v1/projects/<writekey>/settings
    response = NextResponse.json(segmentsSettings(request.nextUrl.pathname.split("/")[3]));
  } else {
    response = NextResponse.next();
  }
  if (logRequests) {
    if (request.nextUrl.pathname.startsWith("/_next") || request.nextUrl.pathname.startsWith("/favicon.ico")) {
      return response;
    }
    const method = request.method;
    const body = request.body;
    if (body) {
      log.atInfo().log(`${method} ${request.nextUrl.pathname}`, prettifyBody(await request.text()));
    } else {
      log.atInfo().log(`${method} ${request.nextUrl.pathname}`);
    }
  }

  return response;
}

export const config = {
  matcher: !logRequests ? ["/p.js", "/v1/batch*", "/api/s/batch*", "/v1/projects*"] : undefined,
};
