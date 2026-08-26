"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";

type FavoritesValue = {
  signedIn: boolean;
  ready: boolean;
  isFavorite: (appId: string) => boolean;
  toggle: (appId: string) => Promise<"added" | "removed" | "signin-required">;
};

const FavoritesContext = createContext<FavoritesValue | null>(null);

export function useFavorites(): FavoritesValue {
  const value = useContext(FavoritesContext);
  if (!value) throw new Error("useFavorites must be used inside <FavoritesProvider>");
  return value;
}

/**
 * Holds the signed-in user's favourites for the whole page.
 *
 * Resolving this in the browser is what lets the catalogue pages be cached:
 * the server no longer reads cookies to decide which hearts are filled, so the
 * HTML is identical for everyone and safe to serve from a CDN. One query
 * fetches every favourite id — a page showing 300 cards still costs one round
 * trip, not one per card.
 */
export default function FavoritesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function load(userId?: string) {
      if (!userId) {
        if (active) {
          setIds(new Set());
          setSignedIn(false);
          setReady(true);
        }
        return;
      }
      const { data } = await supabase
        .from("favorites")
        .select("app_id")
        .eq("user_id", userId)
        .returns<{ app_id: string }[]>();

      if (!active) return;
      setIds(new Set((data ?? []).map((r) => r.app_id)));
      setSignedIn(true);
      setReady(true);
    }

    supabase.auth.getUser().then(({ data }) => load(data.user?.id));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => load(session?.user?.id));

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const toggle = useCallback(
    async (appId: string): Promise<"added" | "removed" | "signin-required"> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return "signin-required";

      const adding = !ids.has(appId);

      // Optimistic: the heart flips immediately, and rolls back on failure.
      setIds((current) => {
        const next = new Set(current);
        if (adding) next.add(appId);
        else next.delete(appId);
        return next;
      });

      const { error } = adding
        ? await supabase
            .from("favorites")
            .upsert(
              { user_id: user.id, app_id: appId },
              { onConflict: "user_id,app_id" },
            )
        : await supabase
            .from("favorites")
            .delete()
            .eq("user_id", user.id)
            .eq("app_id", appId);

      if (error) {
        setIds((current) => {
          const next = new Set(current);
          if (adding) next.delete(appId);
          else next.add(appId);
          return next;
        });
      }

      return adding ? "added" : "removed";
    },
    [ids],
  );

  const value = useMemo<FavoritesValue>(
    () => ({ signedIn, ready, isFavorite: (id) => ids.has(id), toggle }),
    [ids, signedIn, ready, toggle],
  );

  return (
    <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
  );
}
