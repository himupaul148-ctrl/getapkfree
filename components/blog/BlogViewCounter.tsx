"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Bumps view_count once per mount.
 *
 * Done from the client on purpose: writes to blog_posts are admin-only, and
 * incrementing server-side inside the page would make the route dynamic and
 * throw away its ISR cache. The `increment_blog_view` RPC is SECURITY DEFINER
 * so an anonymous reader can move the counter without any write policy.
 *
 * A ref guard is not enough under React strict mode double-mounting, so the
 * effect keys on the slug and the RPC is cheap and idempotent enough that a
 * duplicate in development does not matter.
 */
export default function BlogViewCounter({ slug }: { slug: string }) {
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      // Fire and forget: a failed counter must never surface to a reader.
      void createClient()
        .rpc("increment_blog_view", { post_slug: slug })
        .then(() => undefined);
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug]);

  return null;
}
