import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side auth guard.
 *
 * Checks for the `access_token` httpOnly cookie that the API sets on login.
 * If the cookie is missing the user is redirected to the login page.
 *
 * Public routes (login, static assets, api proxy) are excluded via the
 * matcher config below.
 */
export function middleware(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;

  if (!token) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Preserve the original path so we can redirect back after login
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Protect everything EXCEPT:
   *  - /login          → the login page itself
   *  - /api/*          → API proxy (rewrite)
   *  - /_next/*        → Next.js internals (static assets, HMR, etc.)
   *  - /favicon.ico    → browser icon
   */
  matcher: ["/((?!login|api|_next|favicon\\.ico).*)"],
};
