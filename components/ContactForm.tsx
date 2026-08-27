"use client";

import { useRef, useState } from "react";
import { CONTACT_EMAIL } from "@/lib/site-config";

const MESSAGE_MIN = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Field = "name" | "email" | "subject" | "message";

export default function ContactForm() {
  const [values, setValues] = useState<Record<Field, string>>({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Honeypot value, and when the form first rendered — both are checked
  // server-side too, because a bot posting straight to the API never runs this.
  const honeypot = useRef("");
  const mountedAt = useRef(Date.now());

  function set(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function validate(): boolean {
    const next: Partial<Record<Field, string>> = {};
    if (!values.name.trim()) next.name = "Please enter your name.";
    if (!values.email.trim()) next.email = "Please enter your email address.";
    else if (!EMAIL_RE.test(values.email.trim())) {
      next.email = "That does not look like an email address.";
    }
    if (!values.subject.trim()) next.subject = "Please enter a subject.";
    if (!values.message.trim()) next.message = "Please enter a message.";
    else if (values.message.trim().length < MESSAGE_MIN) {
      next.message = `Please write at least ${MESSAGE_MIN} characters.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!validate()) return;

    setSending(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          website: honeypot.current,
          elapsed: Date.now() - mountedAt.current,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(body.error ?? "The message could not be sent.");

      setSent(true);
      setValues({ name: "", email: "", subject: "", message: "" });
    } catch (caught) {
      setFailure(
        caught instanceof Error
          ? caught.message
          : "The message could not be sent.",
      );
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-brand-500/40 bg-brand-500/10 p-6">
        <p className="font-semibold text-brand-300">
          Thanks for reaching out! We&rsquo;ll respond within 24–48 hours.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-3 text-sm text-brand-300 underline hover:no-underline"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {failure && (
        <div className="rounded-xl border border-danger-500/40 bg-danger-500/10 p-4 text-sm">
          <p className="text-danger-300">{failure}</p>
          {/* A failed send must not swallow the message — give them the
              address so the attempt is not wasted. */}
          <p className="mt-2 text-fg-muted">
            You can email us directly at{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-brand-400 underline hover:no-underline"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="name"
          label="Name"
          value={values.name}
          error={errors.name}
          onChange={(v) => set("name", v)}
          autoComplete="name"
        />
        <Field
          id="email"
          label="Email"
          type="email"
          value={values.email}
          error={errors.email}
          onChange={(v) => set("email", v)}
          autoComplete="email"
        />
      </div>

      <Field
        id="subject"
        label="Subject"
        value={values.subject}
        error={errors.subject}
        onChange={(v) => set("subject", v)}
      />

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-fg">
          Message <span className="text-danger-300">*</span>
        </label>
        <textarea
          id="message"
          required
          rows={6}
          value={values.message}
          onChange={(e) => set("message", e.target.value)}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? "message-error" : undefined}
          className={`mt-1.5 w-full rounded-xl border bg-base-950 px-3.5 py-2.5 text-sm text-fg outline-none focus:border-brand-500 ${
            errors.message ? "border-danger-500" : "border-base-700"
          }`}
        />
        {errors.message ? (
          <p id="message-error" className="mt-1.5 text-sm text-danger-300">
            {errors.message}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-fg-dim">
            At least {MESSAGE_MIN} characters.
          </p>
        )}
      </div>

      {/* Hidden from people and from screen readers; bots fill it anyway. */}
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label htmlFor="website">Leave this field empty</label>
        <input
          id="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          onChange={(e) => {
            honeypot.current = e.target.value;
          }}
        />
      </div>

      <button
        type="submit"
        disabled={sending}
        className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-bold text-base-950 transition-colors hover:bg-brand-400 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none disabled:opacity-40"
      >
        {sending ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  error,
  onChange,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label} <span className="text-danger-300">*</span>
      </label>
      <input
        id={id}
        type={type}
        required
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`mt-1.5 w-full rounded-xl border bg-base-950 px-3.5 py-2.5 text-sm text-fg outline-none focus:border-brand-500 ${
          error ? "border-danger-500" : "border-base-700"
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-danger-300">
          {error}
        </p>
      )}
    </div>
  );
}
