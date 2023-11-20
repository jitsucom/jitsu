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

const log = getServerLog("request-logger");

export async function middleware(request: NextRequest) {
  let response;
  if (request.nextUrl.pathname.startsWith("/p.js")) {
    response = NextResponse.rewrite(new URL("/api/s/javascript-library", request.url));
  } else if (request.nextUrl.pathname.startsWith("/v1/batch")) {
    response = NextResponse.rewrite(new URL("/api/s/batch", request.url));
  } else if (request.nextUrl.pathname.startsWith("/v1/b")) {
    response = NextResponse.rewrite(new URL("/api/s/batch", request.url));
  } else if (request.nextUrl.pathname.startsWith("/v1/projects/")) {
    // mimic segments setting endpoint
    // https://cdn-settings.segment.com/v1/projects/<writekey>/settings
    response = NextResponse.json({});
  } else {
    response = NextResponse.next();
  }
  if (logRequests) {
    const method = request.method;
    const body = request.body;
    if (body) {
      console.log(`${method} ${request.nextUrl.pathname}`, prettifyBody(await request.text()));
    } else {
      console.log(`${method} ${request.nextUrl.pathname}`);
    }
  }

  return response;
}
//
// export const config = {
//   matcher: !logRequests ? ["/p.js", "/v1/batch"] : "",
// };
