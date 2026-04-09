import { NextRequest, NextResponse } from "next/server";

/**
 * Decode the payload of a JWT without verifying the signature.
 * Signature verification is the API's responsibility — the middleware
 * only checks that the token exists and has not expired.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(payload);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isTokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const exp = payload.exp;
  if (typeof exp !== "number") return false;
  // Reject if expired (with 30s grace)
  return exp > Date.now() / 1000 - 30;
}

/**
 * Server-side auth guard.
 *
 * Checks the `access_token` httpOnly cookie set by the API on login.
 * If the cookie is missing or the JWT has expired, redirects to login.
 */
export function middleware(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;

  if (!isTokenValid(token)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
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
   *  - /_next/*        → Next.js internals
   *  - /favicon.ico    → browser icon
   */
  matcher: ["/((?!login|api|_next|favicon\\.ico).*)"],
};
