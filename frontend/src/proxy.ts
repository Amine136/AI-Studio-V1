import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ADMIN_HOST = (process.env.NEXT_PUBLIC_ADMIN_HOST || "adminvibecraft.ouni.space").toLowerCase();

const ADMIN_REDIRECTS = new Map<string, string>([
  ["/", "/admin"],
  ["/login", "/admin/login"],
  ["/users", "/admin/users"],
  ["/codes", "/admin/codes"],
  ["/logs", "/admin/logs"],
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host")?.toLowerCase() || "";
  const isAdmin = host === ADMIN_HOST;

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
