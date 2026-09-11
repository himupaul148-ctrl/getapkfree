import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyGuardedLicenseUpdate,
  applyGuardedTargetSdkUpdate,
  classifyGuardedUpdateResult,
  licenseWriteInstruction,
  parseApplyFlags,
  targetSdkWriteInstruction,
} from "./license-target-sdk-apply.ts";
import {
  planLicenseBackfill,
  planTargetSdkBackfill,
} from "./license-target-sdk-backfill.ts";
import { FakeSupabase } from "./test-helpers/fake-supabase.ts";

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

group("licenseWriteInstruction — eligibility", () => {
  test("NULL current value, F-Droid has one -> eligible, proposed value carried through", () => {
    const decision = planLicenseBackfill({
      currentLicense: null,
      manualFields: [],
      matchStatus: "matched",
      fdroidLicense: "MIT",
    });
    const instruction = licenseWriteInstruction(decision, "MIT");
    assert.deepEqual(instruction, { eligible: true, column: "license", value: "MIT" });
  });

  test("non-null license that disagrees with F-Droid (conflict) -> never eligible for overwrite", () => {
    const decision = planLicenseBackfill({
      currentLicense: "GPL-3.0-only",
      manualFields: [],
      matchStatus: "matched",
      fdroidLicense: "MIT",
    });
    assert.equal(decision.action, "conflict");
    const instruction = licenseWriteInstruction(decision, "MIT");
    assert.equal(instruction.eligible, false);
  });

  test("non-null license that already matches F-Droid -> not eligible either (nothing to write)", () => {
    const decision = planLicenseBackfill({
      currentLicense: "MIT",
      manualFields: [],
      matchStatus: "matched",
      fdroidLicense: "MIT",
    });
    assert.equal(decision.action, "match");
    assert.equal(licenseWriteInstruction(decision, "MIT").eligible, false);
  });

  test("manual override -> never eligible, regardless of values", () => {
    const decision = planLicenseBackfill({
      currentLicense: null,
      manualFields: ["license"],
      matchStatus: "matched",
      fdroidLicense: "MIT",
    });
    assert.equal(licenseWriteInstruction(decision, "MIT").eligible, false);
  });

  test("unmatched F-Droid row (e.g. the removed relagent package) -> skipped, not eligible", () => {
    const decision = planLicenseBackfill({
      currentLicense: null,
      manualFields: [],
      matchStatus: "not-in-index",
      fdroidLicense: null,
    });
    const instruction = licenseWriteInstruction(decision, null);
    assert.deepEqual(instruction, { eligible: false, reason: "not-in-fdroid-index" });
  });

  test("missing source value (F-Droid has no usable license) -> skipped, not eligible", () => {
    const decision = planLicenseBackfill({
      currentLicense: null,
      manualFields: [],
      matchStatus: "matched",
      fdroidLicense: null,
    });
    const instruction = licenseWriteInstruction(decision, null);
    assert.deepEqual(instruction, { eligible: false, reason: "no-fdroid-license" });
  });
});

group("targetSdkWriteInstruction — eligibility", () => {
  test("NULL current value, F-Droid has one -> eligible, raw numeric value carried through", () => {
    const decision = planTargetSdkBackfill({
      currentTargetSdk: null,
      matchStatus: "matched",
      fdroidTargetSdk: 34,
    });
    const instruction = targetSdkWriteInstruction(decision, 34);
    assert.deepEqual(instruction, { eligible: true, column: "target_sdk", value: 34 });
    assert.equal(typeof (instruction as { value: number }).value, "number");
  });

  test("non-null target_sdk that disagrees with F-Droid -> never eligible for overwrite", () => {
    const decision = planTargetSdkBackfill({
      currentTargetSdk: 30,
      matchStatus: "matched",
      fdroidTargetSdk: 34,
    });
    assert.equal(decision.action, "conflict");
    assert.equal(targetSdkWriteInstruction(decision, 34).eligible, false);
  });

  test("non-null target_sdk that already matches -> not eligible (nothing to write)", () => {
    const decision = planTargetSdkBackfill({
      currentTargetSdk: 34,
      matchStatus: "matched",
      fdroidTargetSdk: 34,
    });
    assert.equal(targetSdkWriteInstruction(decision, 34).eligible, false);
  });

  test("no matching build for this exact version_code -> skipped, not eligible", () => {
    const decision = planTargetSdkBackfill({
      currentTargetSdk: null,
      matchStatus: "no-matching-build",
      fdroidTargetSdk: null,
    });
    assert.deepEqual(targetSdkWriteInstruction(decision, null), {
      eligible: false,
      reason: "no-matching-build",
    });
  });

  test("app not in the current F-Droid index -> skipped, not eligible", () => {
    const decision = planTargetSdkBackfill({
      currentTargetSdk: null,
      matchStatus: "not-in-fdroid-index",
      fdroidTargetSdk: null,
    });
    assert.equal(targetSdkWriteInstruction(decision, null).eligible, false);
  });

  test("proposed value is always the raw numeric API level, never an Android release name", () => {
    const decision = planTargetSdkBackfill({
      currentTargetSdk: null,
      matchStatus: "matched",
      fdroidTargetSdk: 34,
    });
    const instruction = targetSdkWriteInstruction(decision, 34);
    assert.equal(instruction.eligible, true);
    if (instruction.eligible) {
      assert.equal(instruction.value, 34);
      assert.notEqual(instruction.value as unknown, "14.0");
      assert.equal(typeof instruction.value, "number");
    }
  });
});

group("parseApplyFlags", () => {
  test("no flags at all -> dry-run (not authorized)", () => {
    assert.deepEqual(parseApplyFlags([]), {
      applyRequested: false,
      confirmed: false,
      authorized: false,
    });
  });

  test("--apply without --confirm=P2-1 -> refuses to write", () => {
    const flags = parseApplyFlags(["--apply"]);
    assert.equal(flags.applyRequested, true);
    assert.equal(flags.authorized, false);
  });

  test("--confirm=P2-1 alone, without --apply -> still not authorized (stays dry-run)", () => {
    const flags = parseApplyFlags(["--confirm=P2-1"]);
    assert.equal(flags.authorized, false);
  });

  test("--apply --confirm=P2-1 together -> authorized to write", () => {
    const flags = parseApplyFlags(["--apply", "--confirm=P2-1"]);
    assert.deepEqual(flags, { applyRequested: true, confirmed: true, authorized: true });
  });

  test("a near-miss confirmation token does not authorize a write", () => {
    assert.equal(parseApplyFlags(["--apply", "--confirm=p2-1"]).authorized, false);
    assert.equal(parseApplyFlags(["--apply", "--confirm=P2-1 "]).authorized, false);
    assert.equal(parseApplyFlags(["--apply", "--confirm=P2"]).authorized, false);
  });
});

group("classifyGuardedUpdateResult", () => {
  test("a matched, updated row -> applied", () => {
    assert.equal(classifyGuardedUpdateResult(1), "applied");
  });

  test("zero matched rows -> skipped-concurrent-change, never treated as success", () => {
    assert.equal(classifyGuardedUpdateResult(0), "skipped-concurrent-change");
  });
});

group("applyGuardedLicenseUpdate — exact row identity and the NULL guard", () => {
  test("writes when the row still holds a null license, touching only that column", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "a1", package_name: "com.example.one", license: null });

    const result = await applyGuardedLicenseUpdate(client(fake), "a1", "MIT");

    assert.equal(result, "applied");
    assert.equal(fake.apps[0].license, "MIT");
  });

  test("exact row identity required: two rows share a package_name, only the targeted id is touched", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "a1", package_name: "com.example.dup", license: null });
    fake.apps.push({ id: "a2", package_name: "com.example.dup", license: null });

    const result = await applyGuardedLicenseUpdate(client(fake), "a2", "Apache-2.0");

    assert.equal(result, "applied");
    assert.equal(fake.apps[0].license, null, "a1 must be untouched even though it shares a package_name");
    assert.equal(fake.apps[1].license, "Apache-2.0");
  });

  test("concurrent-change: license became non-null between read and write -> skipped-concurrent-change, not applied", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "a1", package_name: "com.example.one", license: null });
    fake.onBeforeUpdate = (table) => {
      if (table === "apps") fake.apps[0].license = "Some-Other-License";
    };

    const result = await applyGuardedLicenseUpdate(client(fake), "a1", "MIT");

    assert.equal(result, "skipped-concurrent-change");
    assert.equal(fake.apps[0].license, "Some-Other-License", "the concurrent value must survive untouched");
  });

  test("a row whose license is already non-null is refused by the guard itself, defence in depth", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "a1", package_name: "com.example.one", license: "GPL-3.0-only" });

    const result = await applyGuardedLicenseUpdate(client(fake), "a1", "MIT");

    assert.equal(result, "skipped-concurrent-change");
    assert.equal(fake.apps[0].license, "GPL-3.0-only");
  });

  test("the update payload contains no unrelated fields — only the one intended column", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "a1", package_name: "com.example.one", license: null, name: "Example", category: "Tools" });

    let capturedPayload: Record<string, unknown> | null = null;
    fake.onBeforeUpdate = (_table, payload) => {
      capturedPayload = payload;
    };

    await applyGuardedLicenseUpdate(client(fake), "a1", "MIT");

    assert.deepEqual(Object.keys(capturedPayload!), ["license"]);
  });

  test("idempotent second run: after a successful apply, planLicenseBackfill now returns 'match', so nothing is re-written", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "a1", package_name: "com.example.one", license: null });

    const first = await applyGuardedLicenseUpdate(client(fake), "a1", "MIT");
    assert.equal(first, "applied");

    // Re-derive the decision against the now-updated row, exactly as a
    // second dry-run/apply invocation would.
    const secondDecision = planLicenseBackfill({
      currentLicense: fake.apps[0].license as string | null,
      manualFields: [],
      matchStatus: "matched",
      fdroidLicense: "MIT",
    });
    assert.equal(secondDecision.action, "match");
    assert.equal(licenseWriteInstruction(secondDecision, "MIT").eligible, false);

    // And even if something tried to write again anyway, the guard refuses it.
    const second = await applyGuardedLicenseUpdate(client(fake), "a1", "MIT");
    assert.equal(second, "skipped-concurrent-change");
  });
});

group("applyGuardedTargetSdkUpdate — exact row identity and the NULL guard", () => {
  test("writes the raw numeric API level when the row still holds a null target_sdk", async () => {
    const fake = new FakeSupabase();
    fake.versions.push({ id: "v1", app_id: "a1", version_code: 3, target_sdk: null });

    const result = await applyGuardedTargetSdkUpdate(client(fake), "v1", 34);

    assert.equal(result, "applied");
    assert.equal(fake.versions[0].target_sdk, 34);
    assert.equal(typeof fake.versions[0].target_sdk, "number");
  });

  test("a row whose target_sdk is already non-null is refused, even if the new value differs", async () => {
    const fake = new FakeSupabase();
    fake.versions.push({ id: "v1", app_id: "a1", version_code: 3, target_sdk: 30 });

    const result = await applyGuardedTargetSdkUpdate(client(fake), "v1", 34);

    assert.equal(result, "skipped-concurrent-change");
    assert.equal(fake.versions[0].target_sdk, 30);
  });

  test("concurrent-change on target_sdk -> skipped-concurrent-change, not applied", async () => {
    const fake = new FakeSupabase();
    fake.versions.push({ id: "v1", app_id: "a1", version_code: 3, target_sdk: null });
    fake.onBeforeUpdate = (table) => {
      if (table === "versions") fake.versions[0].target_sdk = 28;
    };

    const result = await applyGuardedTargetSdkUpdate(client(fake), "v1", 34);

    assert.equal(result, "skipped-concurrent-change");
    assert.equal(fake.versions[0].target_sdk, 28);
  });

  test("exact row identity: two versions of the same app_id, only the targeted version id is touched", async () => {
    const fake = new FakeSupabase();
    fake.versions.push({ id: "v1", app_id: "a1", version_code: 3, target_sdk: null });
    fake.versions.push({ id: "v2", app_id: "a1", version_code: 4, target_sdk: null });

    await applyGuardedTargetSdkUpdate(client(fake), "v2", 34);

    assert.equal(fake.versions[0].target_sdk, null, "v1 must be untouched");
    assert.equal(fake.versions[1].target_sdk, 34);
  });

  test("the update payload contains no unrelated fields", async () => {
    const fake = new FakeSupabase();
    fake.versions.push({ id: "v1", app_id: "a1", version_code: 3, target_sdk: null, min_android_version: "9.0" });

    let capturedPayload: Record<string, unknown> | null = null;
    fake.onBeforeUpdate = (_table, payload) => {
      capturedPayload = payload;
    };

    await applyGuardedTargetSdkUpdate(client(fake), "v1", 34);

    assert.deepEqual(Object.keys(capturedPayload!), ["target_sdk"]);
  });
});
