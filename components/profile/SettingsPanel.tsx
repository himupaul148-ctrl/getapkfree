"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import type { Profile } from "@/lib/profile";

export default function SettingsPanel({ profile }: { profile: Profile }) {
  const [appUpdates, setAppUpdates] = useState(profile.notify_app_updates);
  const [security, setSecurity] = useState(profile.notify_security_alerts);
  const [saved, setSaved] = useState(false);

  async function persist(patch: Record<string, boolean>) {
    const supabase = createClient();
    await supabase.from("users").update(patch).eq("id", profile.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Settings</h2>
        {saved && (
          <p role="status" className="mt-2 text-sm text-brand-400">
            Saved.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-base-800 bg-base-900 p-6">
        <h3 className="font-semibold text-fg">Appearance</h3>
        <p className="mt-1 text-sm text-fg-muted">
          Applies immediately and is remembered on this device. Signed in, it
          also follows you to other devices.
        </p>
        <div className="mt-4">
          <ThemeToggle initial={profile.theme} persist />
        </div>
      </div>

      <div className="rounded-2xl border border-base-800 bg-base-900 p-6">
        <h3 className="font-semibold text-fg">Notifications</h3>
        <p className="mt-1 text-sm text-fg-muted">
          Preferences are saved to your account. Delivery is not yet
          implemented, so nothing is sent regardless of these settings.
        </p>

        <div className="mt-5 space-y-1">
          <Toggle
            label="App update alerts"
            description="When an app you have favourited publishes a new build."
            checked={appUpdates}
            onChange={(value) => {
              setAppUpdates(value);
              persist({ notify_app_updates: value });
            }}
          />
          <Toggle
            label="Security alerts"
            description="When a build you downloaded is later flagged or withdrawn."
            checked={security}
            onChange={(value) => {
              setSecurity(value);
              persist({ notify_security_alerts: value });
            }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-base-800 bg-base-900 p-6">
        <h3 className="font-semibold text-fg">Session</h3>
        <p className="mt-1 text-sm text-fg-muted">
          Signs you out on this device. Your favourites and history stay on your
          account.
        </p>
        <form action="/auth/signout" method="post" className="mt-4">
          <button
            type="submit"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-2.5 text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/20"
          >
            Log out
          </button>
        </form>
      </div>
    </section>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-t border-base-800 py-4 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="text-sm text-fg-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-brand-500" : "bg-base-700"
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
