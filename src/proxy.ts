import { type NextRequest } from "next/server";
import { refreshSession, requireAuth } from "@/utils/supabase/proxy";

// Routes accessible without authentication
const PUBLIC_PATHS = ["/", "/login", "/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  return isPublic(pathname) ? refreshSession(request) : requireAuth(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
