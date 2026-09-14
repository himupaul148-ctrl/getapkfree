/**
 * A minimal, in-memory stand-in for the Supabase query builder — just
 * enough of `.from().select().eq().maybeSingle()` / `.insert().select().single()`
 * / `.update().eq()` / `.delete().eq()` and `.storage.from().upload()/remove()/
 * getPublicUrl()` to exercise lib/apk/save-build.ts,
 * lib/apk/import-pipeline.ts, (via the play_import_proposals table)
 * lib/metadata/play-proposal-store.ts, (via the play_watchlist table)
 * lib/metadata/play-watchlist-store.ts, and (via the play_discovery_candidates
 * table) lib/metadata/play-discovery-store.ts, without touching a real
 * database or network. Also backs (via the github_apk_enrichment_attempts
 * table) lib/apk/github-apk-enrichment-store.ts.
 *
 * Not a test file itself (no `.test.ts` suffix), so `npm test`'s
 * `lib/**\/*.test.ts` glob does not try to run it directly.
 */

type Row = Record<string, unknown>;
type TableName =
  | "apps"
  | "versions"
  | "play_import_proposals"
  | "play_watchlist"
  | "play_discovery_candidates"
  | "github_apk_enrichment_attempts";

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export class FakeSupabase {
  apps: Row[] = [];
  versions: Row[] = [];
  play_import_proposals: Row[] = [];
  play_watchlist: Row[] = [];
  play_discovery_candidates: Row[] = [];
  github_apk_enrichment_attempts: Row[] = [];

  storageUploads: { path: string; bytes: unknown }[] = [];
  storageRemovedPaths: string[] = [];
  storageUploadShouldFail = false;

  /**
   * Test-only hook fired just before an insert is evaluated for a clash —
   * lets a test simulate "another request's write landed first" to
   * exercise a race-recovery code path deterministically, without any real
   * concurrency.
   */
  onBeforeInsert: ((table: TableName, payload: Row) => void) | null = null;

  /**
   * Test-only hook fired just before an update's WHERE-matching runs — lets
   * a test simulate a concurrent write landing in the exact window between
   * a caller's own read-then-guard and its follow-up conditional update
   * (e.g. setVersionPublished's optimistic-concurrency check), without any
   * real concurrency.
   */
  onBeforeUpdate: ((table: TableName, payload: Row) => void) | null = null;

  /**
   * Error injection: every operation matching `table`+`op` returns this
   * error instead of running normally, until a test clears it. Sticky
   * rather than one-shot deliberately — a real connection failure would not
   * politely recover for the very next call either, and the pipeline's own
   * pre-check (also an "apps"/"select") must be seen failing exactly like
   * the authoritative lookup that follows it, not just the first of the two.
   */
  forceError: { table: TableName; op: "select" | "insert" | "update"; error: PgError } | null = null;

  from(table: TableName) {
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
  private inFilters: [string, unknown[]][] = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private orderBy: { field: string; ascending: boolean } | null = null;
  private limitTo: number | null = null;
  // Tracks whether .select() was chained after .update() — real PostgREST
  // only returns the affected rows as `data` when a caller explicitly asks
  // for them that way; without it, an update's `data` is always null. This
  // matters for a caller using the returned row count as an optimistic-
  // concurrency check (did the WHERE clause actually match anything?).
  private wantsSelectedRows = false;

  private db: FakeSupabase;
  private table: TableName;

  constructor(db: FakeSupabase, table: TableName) {
    this.db = db;
    this.table = table;
  }

  // Columns are unused: this fake always returns whole rows. Chaining this
  // after .update()/.delete() is what flips wantsSelectedRows — on a plain
  // .select() read query it's a harmless no-op flag nothing consults.
  select() {
    this.wantsSelectedRows = true;
    return this;
  }

  // Real supabase-js's .returns<T>() is a type-only generic cast — a no-op
  // at runtime that just returns `this` for further chaining. Needed here
  // purely so a caller chaining .returns<T[]>() after .in()/.eq() (as
  // lib/apk/github-apk-enrichment-store.ts's getAttemptsByAppIds() does)
  // doesn't hit a missing-method TypeError against this fake.
  returns<T>() {
    return this as unknown as FakeQueryBuilder & { __returns?: T };
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

  // Real Postgrest requires `.is(col, null)` rather than `.eq(col, null)` for
  // a null check — `.eq` on a literal null does not mean SQL's `IS NULL`.
  // This fake's matching is a plain `===` either way, so `is` behaves
  // identically to `eq` here; it exists as its own method purely so callers
  // can write the same `.is(column, null)` guard against this fake that they
  // send to the real client.
  is(field: string, value: unknown) {
    this.filters.push([field, value]);
    return this;
  }

  // Used by callers batching a lookup across a known, fixed set of ids
  // (e.g. lib/apk/github-apk-enrichment-store.ts's getAttemptsByAppIds())
  // instead of one query per id.
  in(field: string, values: unknown[]) {
    this.inFilters.push([field, values]);
    return this;
  }

  // Used by lib/metadata/play-proposal-store.ts's findAnyProposalForPackage()
  // to get the most recent matching row. Actually sorts/limits, rather than
  // a no-op, so a test seeding multiple rows for the same package can rely
  // on real "most recent" behavior instead of arbitrary array order.
  order(field: string, opts?: { ascending?: boolean }) {
    this.orderBy = { field, ascending: opts?.ascending ?? true };
    return this;
  }

  limit(count: number) {
    this.limitTo = count;
    return this;
  }

  private rows(): Row[] {
    return this.db[this.table];
  }

  private matching(): Row[] {
    let result = this.rows().filter(
      (row) =>
        this.filters.every(([f, v]) => row[f] === v) &&
        this.inFilters.every(([f, values]) => values.includes(row[f])),
    );
    if (this.orderBy) {
      const { field, ascending } = this.orderBy;
      result = [...result].sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        const cmp = av! > bv! ? 1 : -1;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitTo !== null) result = result.slice(0, this.limitTo);
    return result;
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
      if (this.table === "play_import_proposals") {
        // Mirrors play_import_proposals_pending_unique: at most one row per
        // (package_name, proposal_type) may have status='pending' at a
        // time. The real table's status default is 'pending' too, and this
        // fake's insert never accepts a caller-supplied status, so a fresh
        // insert is always the row this clash-check needs to guard against.
        const clash = this.rows().find(
          (r) =>
            r.package_name === this.payload!.package_name &&
            r.proposal_type === this.payload!.proposal_type &&
            r.status === "pending",
        );
        if (clash) return { data: null, error: uniqueViolation("play_import_proposals_pending_unique") };
        const row: Row = {
          id: randomId("proposal"),
          status: "pending",
          created_at: new Date().toISOString(),
          decided_at: null,
          decided_by: null,
          rejection_reason: null,
          applied_at: null,
          app_id: null,
          previous_fields: null,
          ...this.payload,
        };
        this.rows().push(row);
        return { data: row as T, error: null };
      }
      if (this.table === "play_discovery_candidates") {
        // Mirrors play_discovery_candidates_source_ref_unique: UNIQUE(source,
        // source_ref). This fake's insert never accepts a caller-supplied
        // status/resolved_play_url/package_name/proposal_id — only source,
        // source_ref, candidate_name, and score — matching
        // insertDiscoveryCandidate()'s own restriction.
        const clash = this.rows().find(
          (r) => r.source === this.payload!.source && r.source_ref === this.payload!.source_ref,
        );
        if (clash) return { data: null, error: uniqueViolation("play_discovery_candidates_source_ref_unique") };
        const row: Row = {
          id: randomId("discovery"),
          status: "found",
          resolved_play_url: null,
          package_name: null,
          proposal_id: null,
          discovered_at: new Date().toISOString(),
          checked_at: null,
          candidate_name: null,
          score: null,
          ...this.payload,
        };
        this.rows().push(row);
        return { data: row as T, error: null };
      }
      if (this.table === "github_apk_enrichment_attempts") {
        // Mirrors github_apk_enrichment_attempts_app_id_key: UNIQUE(app_id)
        // — at most one row per app, exactly matching
        // recordAttempt()'s own insert-then-recover-on-conflict logic.
        const clash = this.rows().find((r) => r.app_id === this.payload!.app_id);
        if (clash) return { data: null, error: uniqueViolation("github_apk_enrichment_attempts_app_id_key") };
        const row: Row = {
          id: randomId("enrichment"),
          message: null,
          owner_repo: null,
          version_id: null,
          attempt_count: 1,
          created_at: new Date().toISOString(),
          ...this.payload,
        };
        this.rows().push(row);
        return { data: row as T, error: null };
      }
    }

    if (this.op === "update" && this.payload) {
      const forced = this.checkForcedError("update");
      if (forced) return { data: null, error: forced };
      this.db.onBeforeUpdate?.(this.table, this.payload);
      const matched = this.matching();
      for (const row of matched) Object.assign(row, this.payload);
      return { data: (this.wantsSelectedRows ? matched : null) as T, error: null };
    }

    if (this.op === "delete") {
      const toRemove = new Set(this.matching());
      this.db[this.table] = this.rows().filter((r) => !toRemove.has(r));
      return { data: null, error: null };
    }

    if (this.op === "select") {
      // Plain multi-row read (no .maybeSingle()/.single() chained) — used by
      // lib/metadata/play-watchlist-store.ts's listWatchlistRows(), which
      // needs every matching row back, not just the first.
      const forced = this.checkForcedError("select");
      if (forced) return { data: null, error: forced };
      return { data: this.matching() as T, error: null };
    }

    return { data: null, error: null };
  }
}
