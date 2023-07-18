import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  let response;
  if (request.nextUrl.pathname.startsWith("/p.js")) {
    response = NextResponse.rewrite(new URL("/api/s/javascript-library", request.url));
  } else {
    response = NextResponse.next();
  }
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = {
  matcher: "",
};
