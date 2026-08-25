import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side client bound to the request's cookies, so server components and
 * route handlers see the signed-in user. Middleware handles token refresh;
 * the setAll catch below covers server components, which cannot write cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a server component; middleware refreshes the session.
          }
        },
      },
    },
  );
}

/** The signed-in auth user, or null. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
