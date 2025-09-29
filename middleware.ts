import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { resolveAuthSecret } from "@/lib/auth/secret";
import { isDevelopmentEnvironment } from "./lib/constants";

const middlewareAuthSecret = resolveAuthSecret();

const AUTH_PAGES = new Set(["/login", "/register"]);

function buildLoginRedirect(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", request.nextUrl.href);
  return loginUrl;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    /**
     * Reuse the resolved authentication secret so JWT verification keeps
     * working even when the environment relies on the deterministic fallback
     * during Playwright runs.
     */
    secret: middlewareAuthSecret,
    secureCookie: !isDevelopmentEnvironment,
  });

  const isSharePath = pathname.startsWith("/share");
  const isAuthPage = AUTH_PAGES.has(pathname);

  if (!token) {
    if (isSharePath) {
      const redirectUrl = encodeURIComponent(request.nextUrl.href);
      return NextResponse.redirect(
        new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
      );
    }

    if (isAuthPage) {
      return NextResponse.next();
    }

    return NextResponse.redirect(buildLoginRedirect(request));
  }

  const tokenType = (token as { type?: string }).type ?? "regular";

  if (isSharePath) {
    return NextResponse.next();
  }

  if (tokenType !== "regular") {
    return NextResponse.redirect(buildLoginRedirect(request));
  }

  if (isAuthPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/share/:path*",
    "/api/:path*",
    "/login",
    "/register",
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
