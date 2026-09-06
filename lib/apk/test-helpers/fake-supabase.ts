/**
 * A minimal, in-memory stand-in for the Supabase query builder — just
 * enough of `.from().select().eq().maybeSingle()` / `.insert().select().single()`
 * / `.update().eq()` / `.delete().eq()` and `.storage.from().upload()/remove()/
 * getPublicUrl()` to exercise lib/apk/save-build.ts and
 * lib/apk/import-pipeline.ts without touching a real database or network.
 *
 * Not a test file itself (no `.test.ts` suffix), so `npm test`'s
 * `lib/**\/*.test.ts` glob does not try to run it directly.
 */

type Row = Record<string, unknown>;

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export class FakeSupabase {
  apps: Row[] = [];
  versions: Row[] = [];

  storageUploads: { path: string; bytes: unknown }[] = [];
  storageRemovedPaths: string[] = [];
  storageUploadShouldFail = false;

  /**
   * Test-only hook fired just before an insert is evaluated for a clash —
   * lets a test simulate "another request's write landed first" to
   * exercise a race-recovery code path deterministically, without any real
   * concurrency.
   */
  onBeforeInsert: ((table: "apps" | "versions", payload: Row) => void) | null = null;

  /**
   * Error injection: every operation matching `table`+`op` returns this
   * error instead of running normally, until a test clears it. Sticky
   * rather than one-shot deliberately — a real connection failure would not
   * politely recover for the very next call either, and the pipeline's own
   * pre-check (also an "apps"/"select") must be seen failing exactly like
   * the authoritative lookup that follows it, not just the first of the two.
   */
  forceError: { table: "apps" | "versions"; op: "select" | "insert" | "update"; error: PgError } | null = null;

  from(table: "apps" | "versions") {
    return new FakeQueryBuilder(this, table);
  }

  storage = {
    // Bucket id is unused: this fake only ever backs the one "apks" bucket
    // the import pipeline and upload form actually call.
    from: () => ({
      upload: async (
        path: string,
        bytes: unknown,
      ): Promise<{ error: { message: string } | null }> => {
        if (this.storageUploadShouldFail) {
          return { error: { message: "simulated storage upload failure" } };
        }
        this.storageUploads.push({ path, bytes });
        return { error: null };
      },
      remove: async (paths: string[]): Promise<{ error: null }> => {
        this.storageRemovedPaths.push(...paths);
        return { error: null };
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://fake.supabase.local/storage/v1/object/public/apks/${path}` },
      }),
    }),
  };
}

type PgError = { message: string; code: string };

function uniqueViolation(constraint: string): PgError {
  return { message: `duplicate key value violates unique constraint "${constraint}"`, code: "23505" };
}

class FakeQueryBuilder {
  private filters: [string, unknown][] = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;

  private db: FakeSupabase;
  private table: "apps" | "versions";

  constructor(db: FakeSupabase, table: "apps" | "versions") {
    this.db = db;
    this.table = table;
  }

  // Columns are unused: this fake always returns whole rows.
  select() {
    return this;
  }

  insert(payload: Row) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value]);
    return this;
  }

  private rows(): Row[] {
    return this.db[this.table];
  }

  private matching(): Row[] {
    return this.rows().filter((row) => this.filters.every(([f, v]) => row[f] === v));
  }

  private checkForcedError(op: "select" | "insert" | "update"): PgError | null {
    const forced = this.db.forceError;
    if (forced && forced.table === this.table && forced.op === op) return forced.error;
    return null;
  }

  async maybeSingle<T = Row>(): Promise<{ data: T | null; error: PgError | null }> {
    const forced = this.checkForcedError("select");
    if (forced) return { data: null, error: forced };
    const [first] = this.matching();
    return { data: (first as T) ?? null, error: null };
  }

  /** Executes insert/update/delete and returns the row — used after `.select().single()` on an insert. */
  single<T = Row>(): Promise<{ data: T | null; error: PgError | null }> {
    return this.run<T>();
  }

  /** `.update()`/`.delete()` are awaited directly, with no `.select()`/`.single()` chained. */
  then<TResult1 = { data: Row | null; error: PgError | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row | null; error: PgError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private async run<T = Row>(): Promise<{ data: T | null; error: PgError | null }> {
    if (this.op === "insert" && this.payload) {
      const forced = this.checkForcedError("insert");
      if (forced) return { data: null, error: forced };

      this.db.onBeforeInsert?.(this.table, this.payload);

      if (this.table === "apps") {
        const clash = this.rows().find((r) => r.package_name === this.payload!.package_name);
        if (clash) return { data: null, error: uniqueViolation("apps_package_name_key") };
        const row: Row = { id: randomId("app"), screenshots: [], rating_count: 0, manual_fields: [], ...this.payload };
        this.rows().push(row);
        return { data: row as T, error: null };
      }
      if (this.table === "versions") {
        const clash = this.rows().find(
          (r) => r.app_id === this.payload!.app_id && r.version_code === this.payload!.version_code,
        );
        if (clash) return { data: null, error: uniqueViolation("versions_app_id_version_code_key") };
        const row: Row = { id: randomId("version"), download_count: 0, ...this.payload };
        this.rows().push(row);
        return { data: row as T, error: null };
      }
    }

    if (this.op === "update" && this.payload) {
      const forced = this.checkForcedError("update");
      if (forced) return { data: null, error: forced };
      for (const row of this.matching()) Object.assign(row, this.payload);
      return { data: null, error: null };
    }

    if (this.op === "delete") {
      const toRemove = new Set(this.matching());
      this.db[this.table] = this.rows().filter((r) => !toRemove.has(r));
      return { data: null, error: null };
    }

    return { data: null, error: null };
  }
}
