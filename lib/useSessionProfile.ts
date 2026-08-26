"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type SessionProfile = {
  username: string | null;
  isAdmin: boolean;
};

/**
 * Reads the signed-in profile in the browser rather than on the server.
 *
 * This exists so the root layout does not have to call cookies(): a dynamic
 * root layout forces *every* route to render dynamically, which rules out ISR
 * and leaves Next.js sending `private, no-cache` on all pages, so no CDN can
 * cache anything. Moving the header's user state here keeps the shared shell
 * cacheable, at the cost of the username appearing a moment after paint.
 *
 * `loading` lets the header render a neutral placeholder instead of flashing
 * "Log in" at someone who is already signed in.
 */
export function useSessionProfile(): SessionProfile & { loading: boolean } {
  const [profile, setProfile] = useState<SessionProfile>({
    username: null,
    isAdmin: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function load(userId: string | undefined, metaName: unknown) {
      if (!userId) {
        if (active) {
          setProfile({ username: null, isAdmin: false });
          setLoading(false);
        }
        return;
      }

      // Show the signup-time username immediately, then confirm against the
      // profile row (which also carries the admin flag).
      if (active && typeof metaName === "string" && metaName) {
        setProfile((p) => ({ ...p, username: metaName }));
      }

      const { data } = await supabase
        .from("users")
        .select("username, is_admin")
        .eq("id", userId)
        .maybeSingle<{ username: string | null; is_admin: boolean }>();

      if (!active) return;
      setProfile({
        username: data?.username ?? (typeof metaName === "string" ? metaName : null),
        isAdmin: data?.is_admin ?? false,
      });
      setLoading(false);
    }

    supabase.auth
      .getUser()
      .then(({ data }) => load(data.user?.id, data.user?.user_metadata?.username));

    // Keep the header honest when the user signs in or out in another tab.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      load(session?.user?.id, session?.user?.user_metadata?.username);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { ...profile, loading };
}
