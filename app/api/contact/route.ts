import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { CONTACT_EMAIL } from "@/lib/site-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ceilings, not just minimums. Without an upper bound this endpoint is a free
 * relay for pushing arbitrary text into an inbox.
 */
const LIMITS = {
  name: 100,
  email: 200,
  subject: 200,
  message: 5000,
} as const;

const MESSAGE_MIN = 10;

// Deliberately loose: the only thing worth checking here is the shape, since
// the address is proved by whether a reply arrives.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Keeps a header injection out of the Subject line. */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Body = {
  name?: unknown;
  email?: unknown;
  subject?: unknown;
  message?: unknown;
  /** Honeypot: a real person never fills this in, it is hidden. */
  website?: unknown;
  /** Milliseconds the form was on screen before submitting. */
  elapsed?: unknown;
};

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const name = singleLine(String(body.name ?? ""));
  const email = singleLine(String(body.email ?? ""));
  const subject = singleLine(String(body.subject ?? ""));
  const message = String(body.message ?? "").trim();

  // Bots fill every field they find, including the hidden one. Answer 200 so
  // they do not learn the field is a trap and start skipping it.
  if (String(body.website ?? "").trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  // A human cannot read four labels and type a message in under two seconds.
  const elapsed = Number(body.elapsed);
  if (Number.isFinite(elapsed) && elapsed < 2000) {
    return NextResponse.json({ ok: true });
  }

  const problems: string[] = [];
  if (!name) problems.push("a name");
  if (!email) problems.push("an email address");
  else if (!EMAIL_RE.test(email)) problems.push("a valid email address");
  if (!subject) problems.push("a subject");
  if (!message) problems.push("a message");
  else if (message.length < MESSAGE_MIN) {
    problems.push(`a message of at least ${MESSAGE_MIN} characters`);
  }

  if (problems.length > 0) {
    return NextResponse.json(
      { error: `Please provide ${problems.join(", ")}.` },
      { status: 400 },
    );
  }

  for (const [field, max] of Object.entries(LIMITS)) {
    const value = { name, email, subject, message }[field as keyof typeof LIMITS];
    if (value.length > max) {
      return NextResponse.json(
        { error: `That ${field} is too long (limit ${max} characters).` },
        { status: 400 },
      );
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Say so plainly rather than reporting a success that never arrives.
    return NextResponse.json(
      {
        error:
          "The contact form is not configured on this deployment. Please email us directly.",
      },
      { status: 503 },
    );
  }

  try {
    const resend = new Resend(apiKey);
    // Defaults to Resend's shared sender so this works before a domain is
    // verified; set CONTACT_FROM once your own domain is set up.
    const from = process.env.CONTACT_FROM ?? "GetApkFree <onboarding@resend.dev>";

    const { error } = await resend.emails.send({
      from,
      to: [CONTACT_EMAIL],
      // replyTo, not from: sending as the visitor would fail SPF and land in
      // spam. This way "reply" in your client goes to them.
      replyTo: email,
      subject: `[GetApkFree] ${subject}`,
      text: [
        `Name:    ${name}`,
        `Email:   ${email}`,
        `Subject: ${subject}`,
        "",
        message,
      ].join("\n"),
      html: `
        <p><strong>Name:</strong> ${escapeHtml(name)}<br>
        <strong>Email:</strong> ${escapeHtml(email)}<br>
        <strong>Subject:</strong> ${escapeHtml(subject)}</p>
        <hr>
        <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
      `,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "The message could not be sent." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (caught) {
    return NextResponse.json(
      {
        error:
          caught instanceof Error
            ? caught.message
            : "The message could not be sent.",
      },
      { status: 502 },
    );
  }
}
