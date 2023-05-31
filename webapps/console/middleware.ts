import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/p.js")) {
    return NextResponse.rewrite(new URL("/api/s/javascript-library", request.url));
  }
}

export const config = {
  matcher: "/p.js",
};
