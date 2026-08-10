import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const pathname = request.nextUrl.pathname;

  // If incoming host is adminvibecraft... or prodxvibecraft... and visiting root `/`, rewrite to `/admin`
  if ((host.includes("adminvibecraft") || host.includes("prodxvibecraft")) && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
