#!/usr/bin/env node
/**
 * Publishes markdown files from blog-posts/ to the site.
 *
 *   node scripts/publish-blog-posts.mjs <file.md> [more.md ...]
 *
 * Reads BLOG_PUBLISH_TOKEN and SITE_URL from the environment. Used by
 * .github/workflows/publish-blog.yml, and runnable by hand for a dry run:
 *
 *   DRY_RUN=1 node scripts/publish-blog-posts.mjs blog-posts/*.md
 *
 * Deliberately dependency-free so CI does not need `npm ci` to publish a post —
 * the workflow finishes in seconds rather than waiting on a full install.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const CATEGORIES = [
  "privacy",
  "productivity",
  "gaming",
  "tools",
  "guides",
  "news",
];

/**
 * Frontmatter parser for exactly the documented format: `key: value`, with
 * optional quotes, and inline `[a, b]` arrays.
 *
 * This is not a general YAML parser and does not pretend to be. Anything it
 * does not recognise is a hard error rather than a silent guess — a post that
 * publishes with a mis-parsed field is worse than one that fails loudly in CI.
 */
export function parseFrontmatter(source, filename = "post") {
  const normalised = source.replace(/^﻿/, "").replace(/\r\n/g, "\n");

  const match = normalised.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(
      `${filename}: no frontmatter found. The file must start with a line of "---", ` +
        `then key: value lines, then a closing "---".`,
    );
  }

  const [, head, body] = match;
  const data = {};

  head.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) return;

    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new Error(
        `${filename}: frontmatter line ${index + 1} is not "key: value" — got "${line.trim()}"`,
      );
    }

    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();

    if (!/^[a-z_][a-z0-9_]*$/i.test(key)) {
      throw new Error(`${filename}: "${key}" is not a valid frontmatter key.`);
    }

    data[key] = parseValue(raw, key, filename);
  });

  return { data, content: body.trim() };
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

function parseValue(raw, key, filename) {
  if (raw === "") return "";

  if (raw.startsWith("[")) {
    if (!raw.endsWith("]")) {
      throw new Error(
        `${filename}: "${key}" opens a [ list but does not close it on the same line. ` +
          `Multi-line lists are not supported — write it as ["a", "b"].`,
      );
    }
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((part) => unquote(part.trim()))
      .filter(Boolean);
  }

  if (raw === "true") return true;
  if (raw === "false") return false;

  return unquote(raw);
}

/** Turns a parsed file into the request body, failing on anything unusable. */
export function toPayload(parsed, filename) {
  const { data, content } = parsed;
  const problems = [];

  const title = String(data.title ?? "").trim();
  const slug = String(data.slug ?? "").trim().toLowerCase();
  const description = String(data.description ?? "").trim();
  const category = String(data.category ?? "").trim().toLowerCase();

  if (!title) problems.push("title is missing");
  if (!slug) problems.push("slug is missing");
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    problems.push(`slug "${slug}" must be lowercase words joined by hyphens`);
  }
  if (!description) problems.push("description is missing");
  else if (description.length > 200) {
    problems.push(`description is ${description.length} characters, limit 200`);
  }
  if (!category) problems.push("category is missing");
  else if (!CATEGORIES.includes(category)) {
    problems.push(
      `category "${category}" is not one of: ${CATEGORIES.join(", ")}`,
    );
  }
  if (!content) problems.push("the post body is empty");

  const related = data.related_app_ids;
  if (related !== undefined && !Array.isArray(related)) {
    problems.push('related_app_ids must be a list, e.g. ["id-1", "id-2"]');
  }

  if (problems.length > 0) {
    throw new Error(`${filename}:\n  - ${problems.join("\n  - ")}`);
  }

  return {
    title,
    slug,
    description,
    category,
    content,
    author: String(data.author ?? "").trim() || "GetApkFree Team",
    featured_image_url: String(data.featured_image_url ?? "").trim() || null,
    related_app_ids: Array.isArray(related) ? related : [],
    published: data.published === undefined ? true : data.published === true,
  };
}

async function publish(payload, { siteUrl, token }) {
  const res = await fetch(`${siteUrl}/api/admin/blog/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  }

  if (!res.ok) throw new Error(parsed.error ?? `HTTP ${res.status}`);
  return parsed;
}

async function main() {
  const files = process.argv.slice(2).filter(Boolean);
  if (files.length === 0) {
    console.log("No blog-posts/*.md files changed — nothing to publish.");
    return;
  }

  const dryRun = process.env.DRY_RUN === "1";
  const siteUrl = (process.env.SITE_URL ?? "https://getapkfree.vercel.app")
    .replace(/\/$/, "");
  // Trimmed for the same reason the server trims: a secret pasted into the
  // GitHub box can carry a trailing newline, and the resulting 401 looks
  // exactly like a wrong token.
  const token = (process.env.BLOG_PUBLISH_TOKEN ?? "").trim();

  if (!dryRun && !token) {
    console.error(
      "BLOG_PUBLISH_TOKEN is not set. Add it under Settings → Secrets and " +
        "variables → Actions in this repository. See BLOG_POSTING.md.",
    );
    process.exit(1);
  }

  const results = [];
  let failed = 0;

  for (const file of files) {
    const name = basename(file);
    try {
      const payload = toPayload(
        parseFrontmatter(readFileSync(file, "utf8"), name),
        name,
      );

      if (dryRun) {
        console.log(`✓ ${name} — parsed OK (slug: ${payload.slug}) [dry run]`);
        results.push({ file: name, ok: true, slug: payload.slug, action: "dry-run" });
        continue;
      }

      const result = await publish(payload, { siteUrl, token });
      console.log(`✓ ${name} — ${result.action}: ${result.url}`);
      results.push({ file: name, ok: true, ...result });
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ ${name} — ${message}`);
      results.push({ file: name, ok: false, error: message });
    }
  }

  // The workflow reads this to build its commit comment.
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `results<<__EOF__\n${JSON.stringify(results)}\n__EOF__\n`,
    );
  }

  if (failed > 0) process.exit(1);
}

// Only run when invoked directly, so the parser can be imported by a test.
if (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith("publish-blog-posts.mjs")) {
  await main();
}
