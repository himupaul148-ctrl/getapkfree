/**
 * Shared "reuse-or-create app, then add a build" logic. Extracted from
 * components/admin/UploadForm.tsx so the same rules apply whether a build
 * arrives from a browser file upload (UploadForm, running this against the
 * browser Supabase client) or a server-side remote-URL import (running this
 * against the server Supabase client) — no dependency on either environment,
 * just the Supabase query builder.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Thrown when a build's (app_id, version_code) pair already exists — the DB's own UNIQUE constraint is what actually decides this. */
export class DuplicateVersionError extends Error {
  versionCode: number;
  constructor(versionCode: number) {
    super(`Version code ${versionCode} already exists for this app.`);
    this.name = "DuplicateVersionError";
    this.versionCode = versionCode;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isUniqueViolation(
  error: { message?: string | null; code?: string | null } | null | undefined,
  constraint: string,
): boolean {
  if (!error) return false;
  // Postgres/PostgREST reports a unique violation as code 23505; the
  // constraint name also appears in the message text, which is what the
  // pre-existing inline code already keyed off of.
  return error.code === "23505" || Boolean(error.message?.includes(constraint));
}

export type FindOrCreateAppInput = {
  packageName: string;
  /** Display name for a newly-created app. Ignored when the app already exists. */
  name: string;
  category?: string | null;
  description?: string | null;
  developerName?: string | null;
  iconUrl?: string | null;
};

export type FindOrCreateAppResult = {
  appId: string;
  slug: string;
  /** True only if this call is what inserted the row — callers use this to decide whether a later failure may safely delete it. */
  created: boolean;
};

/**
 * Reuses an app row by `package_name` if one exists, otherwise creates one.
 * `package_name` is the DB's unique app identity (see the schema's own
 * `apps_package_name_key`); slug uniqueness is handled the same way the
 * existing forms already do — a clash gets a short, stable suffix rather
 * than failing the import.
 */
export async function findOrCreateApp(
  supabase: SupabaseClient,
  input: FindOrCreateAppInput,
): Promise<FindOrCreateAppResult> {
  const { data: existing, error: lookupError } = await supabase
    .from("apps")
    .select("id, slug")
    .eq("package_name", input.packageName)
    .maybeSingle<{ id: string; slug: string }>();
  if (lookupError) throw lookupError;
  if (existing) return { appId: existing.id, slug: existing.slug, created: false };

  const base = slugify(input.name) || slugify(input.packageName) || "app";
  const { data: clash } = await supabase
    .from("apps")
    .select("id")
    .eq("slug", base)
    .maybeSingle();
  const slug = clash ? `${base}-${Date.now().toString(36).slice(-4)}` : base;

  const { data: created, error: createError } = await supabase
    .from("apps")
    .insert({
      name: input.name,
      slug,
      package_name: input.packageName,
      category: input.category ?? null,
      description: input.description ?? null,
      developer_name: input.developerName ?? null,
      icon_url: input.iconUrl ?? null,
    })
    .select("id, slug")
    .single<{ id: string; slug: string }>();

  if (createError) {
    // Two concurrent imports of the same package can race here; the
    // package_name UNIQUE constraint is what actually resolves it. Rather
    // than surface a confusing insert error to whichever request lost,
    // reuse the row the winner created.
    if (isUniqueViolation(createError, "apps_package_name_key")) {
      const { data: winner, error: refetchError } = await supabase
        .from("apps")
        .select("id, slug")
        .eq("package_name", input.packageName)
        .maybeSingle<{ id: string; slug: string }>();
      if (refetchError) throw refetchError;
      if (winner) return { appId: winner.id, slug: winner.slug, created: false };
    }
    throw createError;
  }

  return { appId: created.id, slug: created.slug, created: true };
}

export type UpdateAppMetadataInput = {
  category: string | null;
  description: string | null;
  developerName: string | null;
  /** Only overwritten when provided — an editing pass with no new icon must not blank out the existing one. */
  iconUrl?: string | null;
};

/**
 * Refreshes an existing app's editable fields. This is exactly what
 * UploadForm did inline for a reused app; the remote-URL import route does
 * NOT call this — it has no admin-supplied category/description/developer
 * to write, and must not overwrite an existing app's metadata with nulls.
 */
export async function updateAppMetadata(
  supabase: SupabaseClient,
  appId: string,
  input: UpdateAppMetadataInput,
): Promise<void> {
  const { error } = await supabase
    .from("apps")
    .update({
      category: input.category,
      description: input.description,
      developer_name: input.developerName,
      ...(input.iconUrl ? { icon_url: input.iconUrl } : {}),
    })
    .eq("id", appId);
  if (error) throw error;
}

export type CreateVersionInput = {
  appId: string;
  versionName: string;
  versionCode: number;
  fileUrl: string;
  fileSize: number | null;
  minAndroidVersion: string | null;
  permissions: string[];
  scanStatus: string;
  scannedAt: string | null;
  published: boolean;
};

/**
 * Inserts a build row. The DB's `UNIQUE(app_id, version_code)` constraint
 * (`versions_app_id_version_code_key`) is the actual authority on duplicate
 * versions — a caller doing its own pre-check first is a courtesy for a
 * cleaner error message, not a substitute for handling this.
 */
export async function createVersion(
  supabase: SupabaseClient,
  input: CreateVersionInput,
): Promise<{ versionId: string }> {
  const { data, error } = await supabase
    .from("versions")
    .insert({
      app_id: input.appId,
      version_name: input.versionName,
      version_code: input.versionCode,
      file_url: input.fileUrl,
      file_size: input.fileSize,
      min_android_version: input.minAndroidVersion,
      permissions: input.permissions,
      scan_status: input.scanStatus,
      scanned_at: input.scannedAt,
      published: input.published,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    if (isUniqueViolation(error, "versions_app_id_version_code_key")) {
      throw new DuplicateVersionError(input.versionCode);
    }
    throw error;
  }
  return { versionId: data.id };
}

export { slugify };
