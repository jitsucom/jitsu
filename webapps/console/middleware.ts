import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getLog } from "juava";

function isTruish(val: any) {
  return val === "true" || val === "1" || val === "yes" || val === true || val === 1;
}

const logRequests = isTruish(process.env.DEBUG_REQUESTS);

function prettifyBody(body: string) {
  try {
    const obj = JSON.parse(body);
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return body;
  }
}

const log = getLog("request-logger");

export async function middleware(request: NextRequest) {
  let response;
  if (request.nextUrl.pathname.startsWith("/p.js")) {
    response = NextResponse.rewrite(new URL("/api/s/javascript-library", request.url));
  } else if (request.nextUrl.pathname.startsWith("/v1/batch")) {
    response = NextResponse.rewrite(new URL("/api/s/batch", request.url));
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

  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  matcher: "",
};
