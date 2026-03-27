import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function makeClient(request: NextRequest, ref: { res: NextResponse }) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          ref.res = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            ref.res.cookies.set(name, value, options)
          );
        },
      },
    }
  );
}

/** Refreshes session cookies without enforcing auth (for public pages). */
export async function refreshSession(request: NextRequest): Promise<NextResponse> {
  const ref = { res: NextResponse.next({ request }) };
  const supabase = makeClient(request, ref);
  await supabase.auth.getUser();
  return ref.res;
}

/** Refreshes session and redirects to /login if not authenticated. */
export async function requireAuth(request: NextRequest): Promise<NextResponse> {
  const ref = { res: NextResponse.next({ request }) };
  const supabase = makeClient(request, ref);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return ref.res;
}
