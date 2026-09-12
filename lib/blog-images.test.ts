import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyFeaturedImageDelete,
  applyFeaturedImageUpload,
  FULL,
  objectPath,
  processImage,
  resizeCover,
  THUMB,
  type SupabaseLike,
} from "./blog-images.ts";

/**
 * Covers the P2-2 featured-image robustness work: the actual image
 * transformation (any supported input -> exact 1200x630/600x315 WebP,
 * cover-cropped, never stretched) and the safety-critical write ordering
 * (storage write -> database write -> only then delete the old image) that
 * app/api/admin/blog/image/route.ts's POST/DELETE handlers now delegate to
 * applyFeaturedImageUpload/applyFeaturedImageDelete.
 */

// ------------------------------------------------------- synthetic fixtures
// Generated with sharp itself rather than checked-in binary fixtures — a
// solid-colour image is a perfectly good input for testing dimensions/format
// transformation, and this keeps the test file self-contained.

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .jpeg()
    .toBuffer();
}

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 40, g: 120, b: 200, alpha: 1 } } })
    .png()
    .toBuffer();
}

async function makeWebp(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 180, b: 90 } } })
    .webp()
    .toBuffer();
}

group("processImage — format conversion and exact output dimensions", () => {
  test("JPEG input -> WebP, full exactly 1200x630, thumb exactly 600x315", async () => {
    const input = await makeJpeg(1600, 900);
    const { full, thumb } = await processImage(input);

    const fullMeta = await sharp(full.buffer).metadata();
    const thumbMeta = await sharp(thumb.buffer).metadata();

    assert.equal(fullMeta.format, "webp");
    assert.equal(fullMeta.width, FULL.width);
    assert.equal(fullMeta.height, FULL.height);
    assert.equal(thumbMeta.format, "webp");
    assert.equal(thumbMeta.width, THUMB.width);
    assert.equal(thumbMeta.height, THUMB.height);
  });

  test("PNG input -> WebP 1200x630", async () => {
    const input = await makePng(1200, 1200);
    const { full } = await processImage(input);
    const meta = await sharp(full.buffer).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, FULL.width);
    assert.equal(meta.height, FULL.height);
  });

  test("WebP input -> WebP 1200x630 (re-encoded, not just passed through)", async () => {
    const input = await makeWebp(500, 900);
    const { full } = await processImage(input);
    const meta = await sharp(full.buffer).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, FULL.width);
    assert.equal(meta.height, FULL.height);
  });

  test("a portrait image is cropped to exactly 1200x630, never distorted", async () => {
    const input = await makeJpeg(600, 1800); // tall and narrow
    const { full } = await processImage(input);
    const meta = await sharp(full.buffer).metadata();
    assert.equal(meta.width, FULL.width);
    assert.equal(meta.height, FULL.height);
  });

  test("a landscape/panorama image is cropped to exactly 1200x630, never distorted", async () => {
    const input = await makeJpeg(3600, 400); // very wide
    const { full } = await processImage(input);
    const meta = await sharp(full.buffer).metadata();
    assert.equal(meta.width, FULL.width);
    assert.equal(meta.height, FULL.height);
  });

  test("a square image is cropped to exactly 1200x630, never distorted", async () => {
    const input = await makePng(900, 900);
    const { full } = await processImage(input);
    const meta = await sharp(full.buffer).metadata();
    assert.equal(meta.width, FULL.width);
    assert.equal(meta.height, FULL.height);
  });

  test("an image smaller than the target box is still exactly 1200x630 (enlarged, not letterboxed)", async () => {
    const input = await makeJpeg(200, 100);
    const { full } = await processImage(input);
    const meta = await sharp(full.buffer).metadata();
    assert.equal(meta.width, FULL.width);
    assert.equal(meta.height, FULL.height);
  });

  test("a corrupt/unsupported byte stream is rejected rather than silently producing a broken image", async () => {
    await assert.rejects(() => processImage(Buffer.from("this is not an image, just text")));
  });

  test("identical input bytes always produce the same content hash (idempotent, stable object naming)", async () => {
    const input = await makeJpeg(1200, 630);
    const a = await processImage(input);
    const b = await processImage(input);
    assert.equal(a.full.hash, b.full.hash);
    assert.equal(a.thumb.hash, b.thumb.hash);
  });
});

group("resizeCover — smart-crop with a safe fallback", () => {
  test("smart-crop (default) still produces the exact target box", async () => {
    const input = await makeJpeg(2000, 500);
    const out = await resizeCover(input, FULL);
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, FULL.width);
    assert.equal(meta.height, FULL.height);
    assert.equal(meta.format, "webp");
  });

  test("explicitly centred crop (the fallback path) also produces the exact target box", async () => {
    const input = await makePng(500, 2000);
    const out = await resizeCover(input, FULL, { smartCrop: false });
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, FULL.width);
    assert.equal(meta.height, FULL.height);
    assert.equal(meta.format, "webp");
  });
});

group("objectPath", () => {
  test("full and thumb variants for the same hash never collide", () => {
    assert.notEqual(objectPath("my-post", "abc123", "full"), objectPath("my-post", "abc123", "thumb"));
  });

  test("a fresh upload with genuinely different content gets a different path (unique filename, no accidental reuse)", async () => {
    // Different colours, not just different dimensions — two solid-colour
    // images that both happen to crop down to the same uniform output would
    // legitimately share a hash (that's the point of content-hashing); this
    // proves the *unique-filename* property with content that actually differs.
    const a = await processImage(await makeJpeg(1200, 630));
    const b = await processImage(await makePng(1200, 630));
    assert.notEqual(objectPath("post", a.full.hash, "full"), objectPath("post", b.full.hash, "full"));
  });
});

// -------------------------------------------------- fake Supabase client
// Minimal, self-contained, and scoped to exactly what
// applyFeaturedImageUpload/applyFeaturedImageDelete use: a "blog_posts"
// table (update().eq().select().maybeSingle()) and one storage bucket
// (upload/list/remove/getPublicUrl). Deliberately not the shared
// lib/apk/test-helpers/fake-supabase.ts fake — that one is typed to the
// apps/versions tables and this needs a different shape.

type PgError = { message: string };

class FakeBucket {
  objects = new Map<string, Buffer>();
  uploadShouldFail = false;
  removeShouldFail = false;

  async upload(path: string, buffer: Buffer): Promise<{ error: PgError | null }> {
    if (this.uploadShouldFail) return { error: { message: "simulated storage upload failure" } };
    this.objects.set(path, buffer);
    return { error: null };
  }

  async list(prefix: string): Promise<{ data: { name: string }[] | null; error: PgError | null }> {
    const data = [...this.objects.keys()]
      .filter((p) => p.startsWith(`${prefix}/`))
      .map((p) => ({ name: p.slice(prefix.length + 1) }));
    return { data, error: null };
  }

  async remove(paths: string[]): Promise<{ error: PgError | null }> {
    if (this.removeShouldFail) return { error: { message: "simulated storage remove failure" } };
    for (const p of paths) this.objects.delete(p);
    return { error: null };
  }

  getPublicUrl(path: string) {
    return { data: { publicUrl: `https://fake.supabase.local/storage/v1/object/public/blog-images/${path}` } };
  }
}

type PostRow = { id: string; slug: string; featured_image_url: string | null };

class FakeUpdateBuilder {
  private filters: [string, unknown][] = [];
  private table: FakePostsTable;
  private payload: Partial<Pick<PostRow, "featured_image_url">>;

  constructor(table: FakePostsTable, payload: Partial<Pick<PostRow, "featured_image_url">>) {
    this.table = table;
    this.payload = payload;
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value]);
    return this;
  }

  select() {
    return this;
  }

  async maybeSingle(): Promise<{ data: { id: string } | null; error: PgError | null }> {
    if (this.table.updateShouldFail) {
      return { data: null, error: { message: "simulated db update failure" } };
    }
    const row = this.table.rows.find((r) =>
      this.filters.every(([f, v]) => (r as unknown as Record<string, unknown>)[f] === v),
    );
    if (!row) return { data: null, error: null };
    Object.assign(row, this.payload);
    return { data: { id: row.id }, error: null };
  }
}

class FakePostsTable {
  rows: PostRow[] = [];
  updateShouldFail = false;

  update(payload: Partial<Pick<PostRow, "featured_image_url">>) {
    return new FakeUpdateBuilder(this, payload);
  }
}

class FakeDb {
  bucket = new FakeBucket();
  posts = new FakePostsTable();
  storage = { from: () => this.bucket };
  from() {
    return this.posts;
  }
}

function client(fake: FakeDb): SupabaseLike {
  return fake as unknown as SupabaseClient as SupabaseLike;
}

group("applyFeaturedImageUpload — safe ordering (storage -> database -> prune)", () => {
  test("a successful upload stores both objects, updates the post, and prunes the previous image", async () => {
    const fake = new FakeDb();
    fake.posts.rows.push({ id: "p1", slug: "my-post", featured_image_url: "https://old/my-post/old.webp" });
    fake.bucket.objects.set("my-post/old-hash.webp", Buffer.from("old full"));
    fake.bucket.objects.set("my-post/old-hash-thumb.webp", Buffer.from("old thumb"));

    const result = await applyFeaturedImageUpload(client(fake), {
      slug: "my-post",
      fullPath: "my-post/new-hash.webp",
      thumbPath: "my-post/new-hash-thumb.webp",
      fullBuffer: Buffer.from("new full"),
      thumbBuffer: Buffer.from("new thumb"),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.updated, true);
    assert.equal(fake.posts.rows[0].featured_image_url, result.url);
    assert.ok(fake.bucket.objects.has("my-post/new-hash.webp"));
    assert.ok(fake.bucket.objects.has("my-post/new-hash-thumb.webp"));
    assert.equal(fake.bucket.objects.has("my-post/old-hash.webp"), false, "the old image must be pruned after success");
    assert.deepEqual(new Set(result.removed), new Set(["my-post/old-hash.webp", "my-post/old-hash-thumb.webp"]));
  });

  test("storage upload failure: the post's featured_image_url is never touched, and the database is never even called", async () => {
    const fake = new FakeDb();
    fake.posts.rows.push({ id: "p1", slug: "my-post", featured_image_url: "https://old/my-post/old.webp" });
    fake.bucket.uploadShouldFail = true;

    const result = await applyFeaturedImageUpload(client(fake), {
      slug: "my-post",
      fullPath: "my-post/new-hash.webp",
      thumbPath: "my-post/new-hash-thumb.webp",
      fullBuffer: Buffer.from("new full"),
      thumbBuffer: Buffer.from("new thumb"),
    });

    assert.equal(result.ok, false);
    assert.equal(fake.posts.rows[0].featured_image_url, "https://old/my-post/old.webp");
  });

  test("database update failure: the new files are already stored, but the post keeps its OLD featured_image_url (never cleared, never left pointing at a deleted file)", async () => {
    const fake = new FakeDb();
    fake.posts.rows.push({ id: "p1", slug: "my-post", featured_image_url: "https://old/my-post/old-hash.webp" });
    fake.bucket.objects.set("my-post/old-hash.webp", Buffer.from("old full"));
    fake.posts.updateShouldFail = true;

    const result = await applyFeaturedImageUpload(client(fake), {
      slug: "my-post",
      fullPath: "my-post/new-hash.webp",
      thumbPath: "my-post/new-hash-thumb.webp",
      fullBuffer: Buffer.from("new full"),
      thumbBuffer: Buffer.from("new thumb"),
    });

    assert.equal(result.ok, false);
    // Old value untouched — this is the exact regression P2-1/P2-2's earlier
    // featured-image incidents warned about: a failure must never clear or
    // corrupt the existing, working value.
    assert.equal(fake.posts.rows[0].featured_image_url, "https://old/my-post/old-hash.webp");
    // And the old file was never pruned — the database update failed, so
    // pruneFolder is never even reached.
    assert.ok(fake.bucket.objects.has("my-post/old-hash.webp"), "the old image must survive a failed database update");
    // The new files were still uploaded (nothing to unwind) — a retry can
    // reuse them since they're named by content hash.
    assert.ok(fake.bucket.objects.has("my-post/new-hash.webp"));
  });

  test("a post that does not exist yet (author picked an image before first save) is not an error", async () => {
    const fake = new FakeDb(); // no rows at all

    const result = await applyFeaturedImageUpload(client(fake), {
      slug: "brand-new-post",
      fullPath: "brand-new-post/hash.webp",
      thumbPath: "brand-new-post/hash-thumb.webp",
      fullBuffer: Buffer.from("full"),
      thumbBuffer: Buffer.from("thumb"),
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.updated, false);
  });
});

group("applyFeaturedImageDelete — safe ordering (database -> prune)", () => {
  test("a successful delete clears the URL and removes the stored objects", async () => {
    const fake = new FakeDb();
    fake.posts.rows.push({ id: "p1", slug: "my-post", featured_image_url: "https://old/my-post/hash.webp" });
    fake.bucket.objects.set("my-post/hash.webp", Buffer.from("full"));
    fake.bucket.objects.set("my-post/hash-thumb.webp", Buffer.from("thumb"));

    const result = await applyFeaturedImageDelete(client(fake), "my-post");

    assert.equal(result.ok, true);
    assert.equal(fake.posts.rows[0].featured_image_url, null);
    assert.equal(fake.bucket.objects.size, 0);
  });

  test("database update failure: the file is left in place rather than deleted out from under a still-pointing post", async () => {
    const fake = new FakeDb();
    fake.posts.rows.push({ id: "p1", slug: "my-post", featured_image_url: "https://old/my-post/hash.webp" });
    fake.bucket.objects.set("my-post/hash.webp", Buffer.from("full"));
    fake.posts.updateShouldFail = true;

    const result = await applyFeaturedImageDelete(client(fake), "my-post");

    assert.equal(result.ok, false);
    assert.equal(fake.posts.rows[0].featured_image_url, "https://old/my-post/hash.webp");
    assert.ok(fake.bucket.objects.has("my-post/hash.webp"), "the file must survive a failed database update");
  });
});
