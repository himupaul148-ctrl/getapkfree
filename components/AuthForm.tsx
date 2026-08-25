"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export default function AuthForm({
  mode,
  next = "/profile",
  initialError,
}: {
  mode: Mode;
  next?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, setPending] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        // Full navigation so the server re-renders with the new session cookie.
        router.push(next);
        router.refresh();
        return;
      }

      const cleanedUsername = username.trim().toLowerCase();
      if (cleanedUsername.length < 3) {
        throw new Error("Username must be at least 3 characters.");
      }
      if (!/^[a-z0-9_]+$/.test(cleanedUsername)) {
        throw new Error("Username can only contain letters, numbers and underscores.");
      }
      if (password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }

      const { data: available, error: rpcError } = await supabase.rpc(
        "is_username_available",
        { candidate: cleanedUsername },
      );
      if (rpcError) throw rpcError;
      if (available === false) {
        throw new Error("That username is already taken.");
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { username: cleanedUsername },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) throw error;

      // With email confirmation on, signUp returns no session.
      if (data.session) {
        router.push(next);
        router.refresh();
      } else {
        setCheckEmail(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (checkEmail) {
    return (
      <div className="rounded-2xl border border-brand-500/30 bg-brand-500/5 p-6">
        <h2 className="font-semibold text-brand-300">Confirm your email</h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          We sent a confirmation link to{" "}
          <span className="text-fg">{email.trim()}</span>. Open it to activate
          your account, and you will be signed in automatically.
        </p>
        <p className="mt-3 text-sm text-fg-dim">
          Nothing arrived? Check spam. This project uses Supabase&rsquo;s built-in
          mail service, which is rate limited to a handful of messages per hour.
        </p>
      </div>
    );
  }

  const isSignup = mode === "signup";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      <Field
        id="email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
        required
      />

      {isSignup && (
        <Field
          id="username"
          label="Username"
          type="text"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          hint="Letters, numbers and underscores. At least 3 characters."
          required
        />
      )}

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-fg">
          Password
        </label>
        <div className="relative mt-1.5">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            minLength={isSignup ? 8 : undefined}
            className="w-full rounded-xl border border-base-700 bg-base-850 py-2.5 pr-20 pl-3.5 text-sm text-fg placeholder:text-fg-dim focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-fg-dim hover:text-fg"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        {isSignup && (
          <p className="mt-1.5 text-xs text-fg-dim">At least 8 characters.</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-brand-500 px-6 py-3 font-semibold text-base-950 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? isSignup
            ? "Creating account…"
            : "Signing in…"
          : isSignup
            ? "Create account"
            : "Log in"}
      </button>

      <p className="text-center text-sm text-fg-muted">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-brand-400 hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            No account yet?{" "}
            <Link href="/signup" className="text-brand-400 hover:underline">
              Sign up
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  hint,
  required,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-850 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-dim focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
      />
      {hint && <p className="mt-1.5 text-xs text-fg-dim">{hint}</p>}
    </div>
  );
}
