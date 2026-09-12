import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { extractFaqPairs, sanitizeFaqPairs } from "./faq.ts";

/**
 * Covers the P0-3 GEO finding: 29 of 31 published posts have a genuine,
 * already-visible "## Frequently Asked Questions" section written as
 * `**Question?**` followed immediately by its answer — content that was
 * previously invisible to structured data. These tests golden-pin the exact
 * pair counts against real, live post content (not synthetic approximations)
 * so a future pipeline change can't silently break real FAQPage markup
 * without a test failing, and separately pin every fail-closed edge case the
 * parser must get right given it runs on admin-authored content.
 *
 * The four POST_* fixtures below are real, published blog_posts.content,
 * captured during the P0-3 audit. POST_A is the complete article verbatim;
 * POST_B and POST_C have some of their non-FAQ middle sections condensed to
 * one sentence purely to keep this file a reasonable size — every heading,
 * the full "## Frequently Asked Questions" section, and the surrounding
 * section boundaries are untouched and byte-identical to the live post, and
 * every sentence that remains is real text from that post, not fabricated.
 * This file makes no database or content changes — these exist only as
 * regression fixtures.
 */

const POST_A = `If you've ever tried to install an app that isn't available in your region, or wanted to try a build that hasn't hit the Play Store yet, you've probably run into the term "APK." Installing one isn't complicated, but doing it safely takes a bit more care than tapping "Download" and hoping for the best.

This guide covers what an APK actually is, when installing one manually makes sense, how to tell a safe file from a risky one, and how to fix the errors people run into most often — written for real Android users, not search engines. If you just want the short version, our [quick install walkthrough](/how-to-install) covers the same core steps.

## What Is an APK File?

APK stands for Android Package Kit. It's the file format Android uses to distribute and install apps — every single app on your phone, including the ones you got from the Play Store, arrived as an APK at some point. The Play Store just handles the download and installation for you automatically, so most people never see the file itself.

An APK is essentially a compressed archive: the app's compiled code, its resources (images, layouts, sounds), a manifest describing what permissions it needs, and a digital signature identifying the developer. That signature matters — Android uses it to verify the app hasn't been tampered with, and to confirm an update comes from the same developer as the original install.

When people talk about "installing an APK," they usually mean installing an app from a file directly, instead of through the Play Store. This is often called **sideloading**.

## When Might You Need to Install an APK Manually?

Manually installing an APK is normal and legitimate in a number of situations:

- **The app isn't listed in your country.** Some apps are region-locked on the Play Store for licensing or regulatory reasons, even though the developer distributes the APK directly.
- **The app is open-source.** Many privacy-focused Android apps are published through F-Droid, GitHub releases, or the developer's own site instead of (or alongside) the Play Store — our own [Tools category](/?category=Tools) is a good place to browse ones that are already scanned and hosted here.
- **You need an older version.** An update might have removed a feature you rely on — some developers keep older release APKs available for exactly this reason.
- **You're testing a beta or early build**, shared directly by the developer ahead of a public rollout.
- **Your device doesn't have Google Play services.** Some tablets, TVs, and budget phones ship without the Play Store, so APK installation is the normal way to get any app.
- **The app was removed from the Play Store**, but the developer still distributes it directly.

None of these are edge cases — they're common, everyday reasons people install APKs. The difference between a safe sideload and a risky one is almost always *where the file came from*.

## How to Check Whether an APK Is Trustworthy

Before you get to the installation steps below, it's worth making sure the file itself deserves your trust — where it came from, who actually built it, and whether its permissions match what it claims to do. That's a big enough topic to cover properly on its own: see our guide on [how to tell if an APK is safe](/blog/how-to-check-if-apk-is-safe) for the full framework, including how to check the source, verify the developer, and scan the file before installing.

## Step-by-Step: How to Install an APK on Android

Once you're confident the file comes from a source you trust, the actual APK installation process is short.

1. **Download the APK** from the trusted source, using your phone's browser or a file transfer from your computer.
2. **Open your Files app** (or your browser's Downloads screen) and locate the downloaded \`.apk\` file.
3. **Tap the file** to begin installation.
4. If this is the first time you're installing from that app (usually your browser or file manager), Android will prompt you to **allow installs from this source** — more on this in the next section.
5. Review the **permissions screen** Android shows you, and confirm you're comfortable with what the app is asking for.
6. Tap **Install** and wait for the process to finish.
7. Tap **Open** to launch the app, or **Done** to return to your home screen.

That's the entire APK installation flow. The extra care happens before step 1, in deciding whether the file is worth installing at all.

## How to Enable "Install Unknown Apps" Safely

Since Android 8 (Oreo), the system no longer has a single global "unknown sources" toggle. Instead, permission is granted **per app** — meaning you specifically allow your browser, file manager, or another app to install APKs, rather than opening the door for anything on your phone to do so.

Here's how to enable it correctly:

1. Go to **Settings**.
2. Search for or navigate to **Apps** → **Special app access** → **Install unknown apps** (the exact wording varies slightly by manufacturer).
3. Select the app you'll use to open the APK — typically your **browser** or **Files** app.
4. Toggle on **Allow from this source**.

A few good habits: only enable this for the specific app you're actually using, not every app on the list; consider turning it back off afterward if you don't sideload regularly; and know that it doesn't disable any other security feature — it only lets that one app trigger installs.

## How to Scan an APK Before Installing It

Scanning a file for malware and confirming you trust it belongs before you tap install, not after. Our guide on [evaluating whether an APK is safe](/blog/how-to-check-if-apk-is-safe) covers how to scan with a multi-engine tool, compare checksums, and read Play Protect's warnings correctly — worth a look if you haven't already.

If Android or Play Protect blocks the install itself, don't just dismiss the warning — the troubleshooting section below covers what a block usually means.

## Common Android Installation Errors and Solutions

Even a legitimate APK can fail to install. Here are the errors people run into most often, and what they usually mean.

### "App not installed"

This generic error has a few common causes:

- **A different version is already installed with a different signature.** If you previously installed the app from the Play Store and are now sideloading a version from elsewhere, Android blocks it because the signatures don't match. Uninstall the existing version first (back up any data you need), then try again.
- **The download is incomplete or corrupted.** Delete the file and download it again.
- **Not enough storage space.** Free up space and retry.

### "Parse error" or "There was a problem parsing the package"

This usually means the file itself is damaged, incomplete, or not a valid APK. Re-download it from the original source rather than trying to fix the existing file.

### "App isn't compatible with your device"

Some APKs are built for a specific processor architecture or a minimum Android version. Check the app's listed requirements against your device's Android version (**Settings → About phone**) before installing.

### Blocked by Play Protect

If Play Protect flags a file, it's worth pausing rather than dismissing the warning immediately. You can view the scan details and choose to proceed, but only do so if you're confident in the source — this is exactly the kind of warning that exists to catch real problems.

### Installation blocked by device policy

On work or managed devices, an IT policy may block sideloading entirely. This isn't a bug — it's a deliberate restriction, and you'd need to check with whoever manages the device.

## How to Uninstall an APK-Installed App

An app installed from an APK uninstalls exactly the same way as one from the Play Store:

1. **Long-press the app's icon** on your home screen or app drawer.
2. Tap **Uninstall** (or drag it to the uninstall option, depending on your launcher).
3. Confirm when prompted.

Alternatively:

1. Open **Settings → Apps**.
2. Find and tap the app.
3. Tap **Uninstall**.

Uninstalling removes the app and, in most cases, its data. If you want to reinstall the same app later, you'll need the APK file again (or the Play Store listing, if it has one).

## Security Mistakes to Avoid

One habit specific to sideloading is worth calling out: unlike Play Store apps, a sideloaded app doesn't update itself automatically, so it's on you to check back for new versions and security fixes.

## Frequently Asked Questions

**Is it legal to install APK files?**
Yes. APK installation is a normal, supported feature of Android. What matters is where the file comes from and whether you're authorized to use the app it contains — installing unauthorized copies of paid software is a separate issue from sideloading in general.

**Is it safe to install APK files on Android?**
It can be, as long as you're deliberate about the source, check permissions, and scan the file first. The steps in this guide are how to bring that risk close to what you'd get installing from the Play Store.

**Do I need an antivirus app to install APKs safely?**
Not necessarily. Play Protect already scans sideloaded apps on most devices. A separate scan through a tool like VirusTotal before installing adds a useful second opinion for files from less-established sources.

**Why does Android say "app not installed" even though the file downloaded fine?**
Most often it's a signature mismatch with an existing install, insufficient storage, or a corrupted download. See the troubleshooting section above.

**Can I install an APK without enabling "install unknown apps"?**
No — Android requires you to explicitly allow the specific app you're using (browser, file manager, etc.) to install packages from outside the Play Store. This is a deliberate safeguard, not an inconvenience to work around.

**Where should I get APKs for paid apps?**
From the Play Store, the developer's official store, or another source you're authorized to purchase from. Sideloading is meant for legitimate use cases like open-source apps, region availability, and beta testing — not for bypassing payment on software you haven't purchased.

## Final Thoughts

Installing an APK isn't inherently risky — it's a standard part of how Android works, and there are plenty of legitimate reasons to do it. The habits that keep it safe are simple: check the source first, read what permissions an app is asking for, scan the file if you're unsure, and leave "install unknown apps" turned on only for the app you're actively using.

Do that consistently, and installing an APK is no riskier than installing anything from the Play Store.`;

const POST_B = `Before installing an APK, it's reasonable to want to know what the app inside it might ask to access — your camera, your location, your contacts. Permissions are genuinely useful information for that. What they aren't is a simple pass/fail label: a long permission list doesn't automatically mean an app is dangerous, and a short one doesn't mean it's trustworthy. This guide covers what permissions actually are, how to check them before installing, and how to judge whether a request makes sense.

## What Are APK Permissions?

A permission is Android's way of gating access to something sensitive — hardware like the camera or microphone, personal data like contacts or location, or a capability like sending notifications. An app declares which permissions it wants, and depending on the permission, Android may also require direct approval before the app can use it.

Some common examples:

- **Camera** — for an app that takes photos or scans documents.
- **Microphone** — for voice recording or calling.
- **Location** — for maps, weather, or anything tied to where you are.
- **Contacts** — for messaging or calling apps that let you pick a recipient.
- **Photos, media, or files** — for anything that opens, saves, or edits files.
- **Notifications** — for apps that need to alert you outside the app itself.

None of these is inherently risky on its own — it depends on whether the requesting app actually has a reason to.

## APK Permissions vs App Permissions

People commonly say "APK permissions," but strictly speaking, permissions belong to the installed application, not the file. An APK's manifest declares which permissions the app *wants* — metadata you can inspect before installing. What actually gets granted is a separate step Android controls: some permissions are granted automatically at install time, while more sensitive ones require approval at runtime, the first time the app tries to use that feature. A permission listed in an APK doesn't mean the app has it — only that it's asking.

## Why Do Android Apps Need Permissions?

Permissions exist because apps need access to do their job:

- A **camera app** needs camera access — that's the point of the app.
- A **navigation app** needs location to show where you are.
- A **messaging app** may request contacts so you can pick who to message.
- A **photo editor** may need photo or media access to edit them.
- A **voice recorder** needs microphone access to record anything.

The useful question is never "does this app want a sensitive permission?" — plenty of ordinary apps do. It's whether the permission matches what the app is for.

## Common Types of Android Permissions

Rather than listing every permission Android defines, here are a few common categories.

### Camera

Reasonable for anything that captures photos or video, or scans something (a document, a QR code, a barcode). Less obviously justified without a visible camera feature.

### Microphone

Expected in calling, voice-recording, and voice-assistant apps. Worth a second look where voice input isn't part of the advertised functionality.

### Location

Used for maps, weather, delivery tracking, and similar. Android distinguishes coarser and more precise location access, and how that's presented has shifted across versions — precise location is generally the more sensitive ask.

### Contacts

Common in messaging, calling, and social apps that let you find or select people you know. Less obviously justified in an app with no social or communication feature.

### Photos, Videos, and Files

Android's own model here has changed across several versions — newer releases handle media and file access more narrowly than older ones did, and the exact permission requested can differ by which version an app targets. The practical point stays the same: this access matters most for apps that genuinely open, save, or share your files.

### Phone, SMS, and Call-Related Access

These sit toward the sensitive end, since they touch communications directly. A dialer or messaging-replacement app has an obvious reason to want them; most other apps don't.

## How to Check an App's Permissions on Android

For an app already installed, Android's own Settings show exactly what it has:

1. Open **Settings**.
2. Go to **Apps** (sometimes **Apps & notifications** or **Application manager**).
3. Select the app.
4. Open **Permissions**.
5. Review what's allowed and what isn't.

Menu names and layout shift between manufacturers and Android versions, so treat this as the general shape rather than an exact match for every device. This only covers an app already installed — it doesn't help before you've decided whether to install.

## How to Check APK Permissions Before Installing

To see what an APK requests *before* installing it, look at the file's own metadata rather than Android's installed-app permission screen, which doesn't exist yet for something you haven't installed.

## How to Tell Whether APK Permissions Make Sense

This is the part that actually matters. A simple, repeatable framework applies here.

## Which Android Permissions Deserve Extra Attention?

A few permissions deserve a closer look because of what they can expose.

## Do APK Permissions Prove an App Is Safe?

No. Permissions are one signal among several, not a verdict.

## What Should You Do If an APK Requests Unusual Permissions?

Pause before installing rather than tapping through automatically.

## Can You Change App Permissions After Installing?

Yes, generally — Android exposes permission controls through the app's own settings page.

## Frequently Asked Questions

**What are APK permissions?**
Declarations in an APK's metadata describing what access the app wants — camera, location, contacts, and similar. What's actually granted is a separate step Android controls.

**How do I check APK permissions before installing?**
Use an APK-information tool that reads the file's metadata directly, rather than the installed-app permission screen, which only applies to apps already on your device.

**Are APK permissions dangerous?**
Not inherently. A permission is only meaningful in context — whether it matches what the app is supposed to do.

**Can an APK request too many permissions?**
It can request more than seems necessary, which is worth questioning — but the number alone isn't the deciding factor; relevance is.

**Does a permission list prove an APK is safe?**
No. It's one signal among several — source, developer identity, package name, version, and signature all matter alongside it.

**Can I change app permissions after installing an APK?**
Generally yes, through the app's settings page, though what's adjustable depends on the Android version and the permission itself.

**Which Android permissions are sensitive?**
Microphone, camera, precise location, contacts, and SMS/phone-related access expose the most — along with special access like accessibility services, granted through their own settings rather than a standard prompt.

**Why does an app need permissions that seem unrelated to its purpose?**
Sometimes there's a genuine reason you haven't considered — but if nothing reasonable comes to mind, treat it as a reason to verify the source before installing.

## Final Thoughts

Permissions are useful information, not a safety score. What matters is whether what an app asks for lines up with what it does — a camera app wanting your camera makes sense; a flashlight app wanting your contacts doesn't.`;

const POST_C = `"Privacy and security" isn't one problem with one app — it's a set of separate tasks: remembering passwords without reusing them, generating a second login factor, keeping a file unreadable if your phone is lost, keeping a message unreadable in transit, automating a Private DNS setting, isolating a work profile, watching a device while it's unattended, and locking your screen fast. The ten apps below each handle one of those tasks, sourced from GetApkFree's System category.

## How We Selected These Apps

- **All ten come from GetApkFree's System category**, which currently holds 37 published, F-Droid-sourced apps.

## A. Passwords & Authentication

### [1Key Password Manager](/app/1key-password-manager)

1Key's own listing describes an offline password manager with 2FA and notes support. No \`INTERNET\` permission is requested.

**Best for:** an offline password vault with built-in 2FA and notes, without a companion account.

## Frequently Asked Questions

**What are the best open-source privacy apps for Android?**
That depends on the task. This list covers ten separate ones — password management, 2FA, file encryption, message encryption, encrypted-container access, DNS automation, work-profile isolation, physical-security monitoring, and screen locking — because no single app does all of them.

**Which apps can manage passwords offline?**
1Key Password Manager, with 2FA and notes support included and no \`INTERNET\` permission in its manifest.

**What's the difference between a password manager and a 2FA authenticator?**
A password manager like 1Key stores login credentials. A 2FA authenticator like Clockwork generates the separate, time-based code some services ask for alongside a password. Keeping them in separate apps means one being compromised doesn't expose both at once.

**Which apps can encrypt files locally?**
Neuron Encrypt and Mage both encrypt files on-device with different approaches — Neuron Encrypt is general local file encryption, Mage is a GUI for the \`age\` format specifically. Salty is different again: it encrypts messages, not files.

**Does Vault Explorer support VeraCrypt?**
Yes — its description lists VeraCrypt, LUKS, and BitLocker container support, plus other unnamed formats described as "and more."

**What is Private DNS on Android?**
A built-in Android setting that lets you specify a DNS provider system-wide. DNS Toggle doesn't create this feature — it adds a Quick Settings shortcut and automation on top of a setting Android already has.

**What is Shizuku, and why might an app need it?**
A separate app that lets other apps request elevated system permissions without full root access, typically via ADB. Harbor requests a Shizuku-related permission, which is why it needs Shizuku set up separately to function fully.

**Why does TapLock need Accessibility Service?**
Its stated function — locking the screen instantly on a double tap — needs the kind of system-wide interaction Android only exposes through that service. It's a broad permission by design, worth understanding before enabling it for any app.

**Does having no \`INTERNET\` permission guarantee privacy?**
No. It means Android blocks that app from standard network requests — a real, checkable fact, but not a broader guarantee about its behavior. An \`INTERNET\` permission by itself does not tell you exactly what network activity an app performs, and the absence of that permission is not by itself a guarantee of complete privacy.

## Final Thoughts

There's no single "most secure" app here, and we're deliberately not naming one.`;

const POST_D = `Storage fills up fastest on the phones that can least afford it. If you are running a device with 32GB or less, a 90MB utility that does one thing is a bad trade.

Everything below is under 10MB installed.

## Why size still matters

A smaller APK usually means fewer bundled SDKs, which means fewer background wakeups and less battery drain. It is a rough proxy, not a rule — but it correlates.

## The list

### 1. Libre Contacts Backup

Around **0.0MB**. See [Libre Contacts Backup](/app/libre-contacts-backup) for the current version, minimum Android release and changelog.

### 2. Emborg

Around **2.3MB**. See [Emborg](/app/emborg) for the current version, minimum Android release and changelog.

## Checking size yourself

Every app page lists the download size next to the button.`;

group("extractFaqPairs — real, published posts", () => {
  test("A. how-to-install-apk-files-on-android-safely -> 6 pairs", () => {
    const pairs = extractFaqPairs(POST_A);
    assert.equal(pairs.length, 6);
  });

  test("B. what-are-apk-permissions-how-to-check -> 8 pairs", () => {
    const pairs = extractFaqPairs(POST_B);
    assert.equal(pairs.length, 8);
  });

  test("C. best-open-source-privacy-security-apps-android -> 9 pairs", () => {
    const pairs = extractFaqPairs(POST_C);
    assert.equal(pairs.length, 9);
  });

  test("D. top-lightweight-tools-under-10mb (no FAQ section) -> []", () => {
    assert.deepEqual(extractFaqPairs(POST_D), []);
  });

  test("E. stops at the next H2 — no pair's answer bleeds into Final Thoughts", () => {
    const pairs = extractFaqPairs(POST_A);
    for (const { answer } of pairs) {
      assert.doesNotMatch(answer, /Final Thoughts|riskier than installing anything/);
    }
  });

  test("I. an ordinary question-shaped H2 outside the FAQ section is not extracted", () => {
    const pairs = extractFaqPairs(POST_B);
    const questions = pairs.map((p) => p.question);
    // The real FAQ question (lowercase "are"), present:
    assert.ok(questions.includes("What are APK permissions?"));
    // The ordinary H2 section heading (capital "Are") earlier in the same
    // post is NOT part of the FAQ block and must not appear:
    assert.ok(!questions.includes("What Are APK Permissions?"));
    assert.ok(!questions.includes("Why Do Android Apps Need Permissions?"));
    assert.ok(!questions.includes("Do APK Permissions Prove an App Is Safe?"));
  });

  test("K. question text is preserved exactly, including punctuation", () => {
    const pairs = extractFaqPairs(POST_C);
    const q = pairs.find((p) => p.question.startsWith("What's the difference"));
    assert.equal(
      q?.question,
      "What's the difference between a password manager and a 2FA authenticator?",
    );
  });
});

group("extractFaqPairs — parsing rules and fail-closed behavior", () => {
  test("finds nothing when there is no FAQ heading at all", () => {
    assert.deepEqual(extractFaqPairs("## Some Section\n\nJust prose, no questions.\n"), []);
  });

  test("recognizes all four allowed heading names, case-insensitively", () => {
    for (const heading of ["Frequently Asked Questions", "FAQ", "FAQs", "Common Questions", "faq"]) {
      const md = `## ${heading}\n\n**Is this recognized?**\nYes, it is.\n`;
      assert.equal(extractFaqPairs(md).length, 1, `heading "${heading}" was not recognized`);
    }
  });

  test("a heading that is merely a substring match is not recognized", () => {
    const md = "## Frequently Asked Questions and Answers\n\n**Is this counted?**\nNo.\n";
    assert.deepEqual(extractFaqPairs(md), []);
  });

  test("E (synthetic). extraction stops at the next H2 even mid-document", () => {
    const md = [
      "## Frequently Asked Questions",
      "",
      "**First question?**",
      "First answer.",
      "",
      "## Unrelated Later Section",
      "",
      "**Not a real FAQ item?**",
      "Should never be reached.",
    ].join("\n");
    const pairs = extractFaqPairs(md);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].question, "First question?");
  });

  test("F. a bold line not ending in '?' is never treated as a question", () => {
    const md = [
      "## FAQ",
      "",
      "**Important note**",
      "This is not a question and must be ignored as one.",
      "",
      "**Is this a real question?**",
      "Yes.",
    ].join("\n");
    const pairs = extractFaqPairs(md);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].question, "Is this a real question?");
  });

  test("G. a blank line between a question and its answer still pairs them", () => {
    const md = ["## FAQ", "", "**Does spacing matter?**", "", "No, it still works."].join("\n");
    const pairs = extractFaqPairs(md);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].answer, "No, it still works.");
  });

  test("H. Markdown links and emphasis inside an answer are normalized to plain text", () => {
    const md = [
      "## FAQ",
      "",
      "**Where can I read more?**",
      "See our [install guide](/how-to-install) for **more** detail and `some code`.",
    ].join("\n");
    const pairs = extractFaqPairs(md);
    assert.equal(
      pairs[0].answer,
      "See our install guide for more detail and some code.",
    );
  });

  test("J. an empty answer (question immediately followed by another question) fails closed", () => {
    const md = [
      "## FAQ",
      "",
      "**Question with no answer?**",
      "**Question with an answer?**",
      "This one has content.",
    ].join("\n");
    const pairs = extractFaqPairs(md);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].question, "Question with an answer?");
  });

  test("J. a FAQ section containing only a heading and no content yields no pairs", () => {
    assert.deepEqual(extractFaqPairs("## Frequently Asked Questions\n"), []);
  });

  test("L. a duplicate question within one FAQ section is not returned twice", () => {
    const md = [
      "## FAQ",
      "",
      "**Repeated question?**",
      "First answer.",
      "",
      "**Repeated question?**",
      "Second answer, should be dropped.",
    ].join("\n");
    const pairs = extractFaqPairs(md);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].answer, "First answer.");
  });

  test("multiple lines of answer prose are joined into one answer", () => {
    const md = [
      "## FAQ",
      "",
      "**Can an answer span lines?**",
      "Yes, this is line one.",
      "And this is line two.",
    ].join("\n");
    const pairs = extractFaqPairs(md);
    assert.equal(pairs[0].answer, "Yes, this is line one. And this is line two.");
  });

  test("does not parse anything from an empty or whitespace-only document", () => {
    assert.deepEqual(extractFaqPairs(""), []);
    assert.deepEqual(extractFaqPairs("   \n\n  "), []);
  });

  test("is deterministic: calling it twice on the same input gives identical output", () => {
    assert.deepEqual(extractFaqPairs(POST_B), extractFaqPairs(POST_B));
  });
});

/**
 * P2-4: sanitizeFaqPairs is the validation extractFaqPairs was refactored to
 * delegate to (the tests above pin that extractFaqPairs' own behavior did
 * not change), and the one non-markdown callers — e.g.
 * lib/how-to-install-faq.ts's page-derived candidates — are expected to use
 * directly instead of re-implementing this validation themselves.
 */
group("sanitizeFaqPairs", () => {
  test("passes through a well-formed candidate unchanged", () => {
    const pairs = sanitizeFaqPairs([
      { question: "Is this valid?", answer: "Yes." },
    ]);
    assert.deepEqual(pairs, [{ question: "Is this valid?", answer: "Yes." }]);
  });

  test("drops a candidate whose question is not phrased as a question", () => {
    const pairs = sanitizeFaqPairs([
      { question: "Not a question", answer: "Some answer." },
    ]);
    assert.deepEqual(pairs, []);
  });

  test("drops a candidate with an empty or whitespace-only answer", () => {
    const pairs = sanitizeFaqPairs([
      { question: "Any answer here?", answer: "" },
      { question: "Any answer here really?", answer: "   " },
    ]);
    assert.deepEqual(pairs, []);
  });

  test("drops a duplicate question, keeping the first occurrence's answer", () => {
    const pairs = sanitizeFaqPairs([
      { question: "Repeated question?", answer: "First." },
      { question: "Repeated question?", answer: "Second, should be dropped." },
    ]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].answer, "First.");
  });

  test("trims and normalizes markdown-style emphasis the same way extractFaqPairs does", () => {
    const pairs = sanitizeFaqPairs([
      { question: "  Is this trimmed?  ", answer: "  Yes, **very** trimmed.  " },
    ]);
    assert.deepEqual(pairs, [
      { question: "Is this trimmed?", answer: "Yes, very trimmed." },
    ]);
  });

  test("an empty list of candidates yields an empty list of pairs", () => {
    assert.deepEqual(sanitizeFaqPairs([]), []);
  });
});
