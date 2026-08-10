import type { NextRequest } from "next";
import { NextResponse } from "next/server";

const ADMIN_HOSTS = new Set(
  [
    "prodxvibecraft.ouni.space",
    "adminvibecraft.ouni.space",
    (process.env.NEXT_PUBLIC_ADMIN_HOST || "").toLowerCase(),
  ].filter(Boolean)
);

const ADMIN_REDIRECTS = new Map<string, string>([
  ["/", "/admin"],
  ["/login", "/admin/login"],
  ["/models", "/admin/models"],
  ["/users", "/admin/users"],
  ["/codes", "/admin/codes"],
  ["/logs", "/admin/logs"],
  ["/warnings", "/admin/warnings"],
  ["/finance", "/admin/finance"],
  ["/feedback", "/admin/feedback"],
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostHeader = (request.headers.get("host") || "").toLowerCase();
  const host = hostHeader.split(":")[0];
  const isAdmin = ADMIN_HOSTS.has(host) || host.startsWith("prodxvibecraft");

  if (isAdmin) {
    const redirectPath = ADMIN_REDIRECTS.get(pathname);
    if (redirectPath) {
      return NextResponse.redirect(new URL(redirectPath, request.url));
    }

    if (pathname === "/auth") {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
