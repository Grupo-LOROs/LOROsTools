import { NextRequest, NextResponse } from "next/server";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

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
  return exp > Date.now() / 1000 - 30;
}

/**
 * Strip the basePath prefix from the full pathname so we can match
 * against application-level routes (e.g. "/login", "/apps").
 */
function stripBasePath(pathname: string): string {
  if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
    return pathname.slice(BASE_PATH.length) || "/";
  }
  return pathname;
}

const PUBLIC_PREFIXES = ["/login", "/_next", "/favicon.ico"];

export function middleware(request: NextRequest) {
  const fullPath = request.nextUrl.pathname;
  const appPath = stripBasePath(fullPath);

  // Allow public routes
  if (PUBLIC_PREFIXES.some((p) => appPath === p || appPath.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Allow API proxy (rewrite operates without basePath)
  if (fullPath.startsWith("/api/") || fullPath === "/api") {
    return NextResponse.next();
  }

  const token = request.cookies.get("access_token")?.value;

  if (!isTokenValid(token)) {
    const loginUrl = request.nextUrl.clone();
    // Redirect to the login page WITH basePath
    loginUrl.pathname = `${BASE_PATH}/login`;
    // Store the app-level path (without basePath) for post-login redirect
    loginUrl.searchParams.set("next", appPath);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all requests — route filtering is handled inside the function
  // because the matcher doesn't account for basePath automatically.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
