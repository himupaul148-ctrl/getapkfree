import { createClient, getUser } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  theme: "dark" | "light" | "system";
  notify_app_updates: boolean;
  notify_security_alerts: boolean;
  is_admin: boolean;
  created_at: string;
};

/** The signed-in user's profile row, or null when signed out. */
export async function getProfile(): Promise<Profile | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  // The row is created by a trigger on signup; fall back to auth data if a
  // legacy account predates it so the UI never renders blank.
  return (
    data ?? {
      id: user.id,
      email: user.email ?? null,
      username: user.email?.split("@")[0] ?? null,
      avatar_url: null,
      theme: "dark",
      notify_app_updates: true,
      notify_security_alerts: true,
      is_admin: false,
      created_at: user.created_at,
    }
  );
}

/** App ids the signed-in user has favourited. Empty set when signed out. */
export async function getFavoriteIds(): Promise<Set<string>> {
  const user = await getUser();
  if (!user) return new Set();

  const supabase = await createClient();
  const { data } = await supabase
    .from("favorites")
    .select("app_id")
    .eq("user_id", user.id)
    .returns<{ app_id: string }[]>();

  return new Set((data ?? []).map((row) => row.app_id));
}
