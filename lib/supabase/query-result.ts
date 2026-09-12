import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Every `{ data, error }` Supabase response in lib/catalogue.ts used to keep
 * only `data`, discarding `error` — collapsing "no row matches" and "the
 * query itself failed" into the same `null`/`[]`. On an ISR route
 * (app/app/[slug]/page.tsx), that meant a transient Supabase error could get
 * rendered as notFound() and then cached as a false 404 for up to an hour.
 *
 * This is the one place that decision is made, kept in its own
 * dependency-free file specifically so it can be imported directly under
 * plain `node --test` — lib/catalogue.ts itself can't be (it imports
 * `unstable_cache` from "next/cache", which the test runner can't resolve;
 * see lib/catalogue.test.ts and lib/catalogue-select.test.ts for the same
 * constraint documented elsewhere in this project).
 */
export function resolveQueryResult<T>(
  data: T,
  error: PostgrestError | null,
  context: string,
): T {
  if (error) {
    throw new Error(context, { cause: error });
  }
  return data;
}
