import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";

const SHARE_PATH_PREFIX = "/share";

export async function GET(request: Request) {
  const currentUrl = new URL(request.url);
  const redirectUrlParam = currentUrl.searchParams.get("redirectUrl");

  if (!redirectUrlParam) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let redirectUrl: URL;

  try {
    redirectUrl = new URL(redirectUrlParam, currentUrl);
  } catch (_error) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (
    redirectUrl.origin !== currentUrl.origin ||
    !redirectUrl.pathname.startsWith(SHARE_PATH_PREFIX)
  ) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (token) {
    return NextResponse.redirect(redirectUrl);
  }

  return signIn("guest", {
    redirect: true,
    redirectTo: redirectUrl.toString(),
  });
}
