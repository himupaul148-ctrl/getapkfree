"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";
import type { Profile } from "@/lib/profile";

export default function AccountPanel({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(profile.username ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const initials = (profile.username ?? profile.email ?? "?")
    .slice(0, 2)
    .toUpperCase();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const cleaned = username.trim().toLowerCase();
    if (cleaned === profile.username) {
      setEditing(false);
      return;
    }
    if (cleaned.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (!/^[a-z0-9_]+$/.test(cleaned)) {
      setError("Username can only contain letters, numbers and underscores.");
      return;
    }

    setPending(true);
    const supabase = createClient();

    const { data: available } = await supabase.rpc("is_username_available", {
      candidate: cleaned,
    });
    if (available === false) {
      setError("That username is already taken.");
      setPending(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ username: cleaned })
      .eq("id", profile.id);

    setPending(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight">My account</h2>

      <div className="mt-5 flex flex-col gap-5 rounded-2xl border border-base-800 bg-base-900 p-6 sm:flex-row sm:items-center">
        {/* Profile picture placeholder — avatar uploads are not built yet. */}
        <span
          aria-hidden="true"
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-azure-500 text-2xl font-bold text-base-950"
        >
          {initials}
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={save} className="space-y-3">
              <div>
                <label
                  htmlFor="edit-username"
                  className="block text-sm font-medium text-fg"
                >
                  Username
                </label>
                <input
                  id="edit-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  className="mt-1.5 w-full max-w-xs rounded-xl border border-base-700 bg-base-850 px-3.5 py-2 text-sm text-fg focus:border-brand-500 focus:outline-none"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-base-950 hover:bg-brand-400 disabled:opacity-60"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setUsername(profile.username ?? "");
                    setError(null);
                  }}
                  className="rounded-lg border border-base-700 px-4 py-2 text-sm text-fg-muted hover:text-fg"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="truncate text-xl font-semibold text-fg">
                {profile.username}
              </p>
              <p className="truncate text-sm text-fg-muted">{profile.email}</p>
              <p className="mt-1 text-xs text-fg-dim">
                Member since {formatDate(profile.created_at)}
              </p>
            </>
          )}
        </div>

        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-xl border border-base-700 px-4 py-2 text-sm text-fg-muted transition-colors hover:border-base-600 hover:text-fg"
          >
            Edit
          </button>
        )}
      </div>

      <p className="mt-4 text-sm text-fg-dim">
        Email changes and avatar uploads are not wired up yet. Your username is
        the only editable field for now.
      </p>
    </section>
  );
}
