import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { extractListicleItems } from "./listicle.ts";

/**
 * Covers the P1-2 GEO finding: the five "best open-source X apps for
 * Android" listicles each present a genuine, ordered, ten-app curated list —
 * every entry a `### [Name](/app/slug)` heading, verified against the
 * Comparison Table each post also has (byte-identical order) and against
 * every app's live existence and category. related_app_ids is empty for all
 * five, so it is deliberately never consulted here; these tests golden-pin
 * the parser against real, live post content (captured during the P1-2
 * audit) so it can't silently drift from what readers actually see.
 *
 * Each fixture below is real, published post content, captured during the
 * P1-2 audit: every H2/H3 heading, every app link (exact name and exact
 * slug), and every "**Best for:**" line is verbatim from the live post.
 * Some of the longer descriptive paragraphs under each heading are
 * shortened purely to keep this file a reasonable size — that prose plays
 * no role in extraction (only the H3 heading lines do) — and the content
 * stops at (and includes) the real "## Comparison Table" heading, since
 * this parser never reads past it. Verified against the real, full-length
 * post content and the live lib/listicle.ts output before being trimmed
 * down for this file. NON_LISTICLE is real content from a post with no
 * listicle structure at all, used to confirm ordinary articles yield [].
 */

const GAMES = `Open the Games category on GetApkFree and you'll notice something quickly: it leans heavily toward puzzle apps. That's not a flaw in the catalogue — plenty of open-source developers gravitate toward grid-based logic games, and the results are genuinely good — but it does mean a straightforward "top ten" pulled from the category would end up as eight puzzle games and two afterthoughts. This list intentionally doesn't do that.

## How We Selected These Games

A few rules shaped this list before any game made it in.

## Puzzle & Word Games

### [Sudoku](/app/sudoku)

This is a clean Sudoku implementation built around logic-based difficulty and helpful assists.

**Best for:** Sudoku players who want difficulty that reflects the actual reasoning a puzzle demands.

### [Wortmühle](/app/wortm-hle)

Wortmühle is a daily German word puzzle: nine letters, one pangram, entirely offline.

**Best for:** German speakers who want a daily word/pangram puzzle.

## Roguelikes

### [Astro Loop](/app/astro-loop)

Astro Loop is described by its own listing as an open-source roguelike shooter.

**Best for:** someone curious about roguelikes who wants a low-commitment entry point.

### [Infra Arcana](/app/infra-arcana)

Infra Arcana bills itself as a Lovecraftian horror roguelike.

**Best for:** roguelike fans specifically looking for horror atmosphere.

## Card & Tabletop Strategy

### [500 - Card game](/app/500-card-game)

This is 500, the Australian trick-taking card game, playable against bots or with friends online.

**Best for:** people who already play 500 and want it on their phone.

### [CBG -- Clavierhaus BackGammon](/app/cbg-clavierhaus-backgammon)

CBG describes itself as the complete GNU Backgammon engine.

**Best for:** backgammon players who want a full-featured engine.

### [Navy Fleet Battle](/app/navy-fleet-battle)

Navy Fleet Battle is described as the classic Russian sea battle game.

**Best for:** fans of grid-based naval combat.

## Something Different

### [Diadem](/app/diadem)

Diadem doesn't fit neatly into any of the categories above.

**Best for:** someone who already has, or knows of, a specific Diadem Map.

## Game-Night Utilities

### [Boardgame Pal](/app/boardgame-pal)

Boardgame Pal is explicitly a companion tool, not a game in its own right.

**Best for:** in-person board game nights that need a phone-based dice roller.

### [Eve Game Tracker](/app/eve-game-tracker)

Eve Game Tracker focuses on one specific job: tracking results for card games.

**Best for:** a regular card-game group that wants a running record.

## Comparison Table`;

const PRODUCTIVITY = `"Productivity" covers a lot of ground, and no single app is going to handle all of it.

## How We Selected These Apps

A few things shaped this list before we get into the recommendations.

## A. Money & Expenses

### [Tallybook](/app/tallybook)

Tallybook is a straightforward expense and budget tracker.

**Best for:** everyday personal expense and budget tracking.

### [Quits](/app/quits)

Quits is built specifically around splitting shared expenses privately.

**Best for:** privately splitting shared expenses with other people.

### [Currency Converter](/app/currency-converter)

Currency Converter does one specific job: converting between currencies offline.

**Best for:** converting currencies without needing a live connection every time.

## B. Tasks & Time

### [ForgetMeNot](/app/forgetmenot)

ForgetMeNot is a todo and reminders app, with integration with Obsidian.

**Best for:** someone who already uses Obsidian and wants their reminders connected to it.

### [SayWhen](/app/saywhen)

SayWhen takes a different approach to adding calendar events: natural-language phrases.

**Best for:** quickly adding calendar events without navigating a form.

### [mAlarm](/app/malarm)

mAlarm is a flexible, no-frills alarm scheduler.

**Best for:** scheduling alarms with a focused, flexible alarm tool.

### [Do The Thing](/app/do-the-thing)

Do The Thing is described as a local-first personal coach.

**Best for:** someone who wants a daily task list curated for them.

## C. Communication

### [Axichat](/app/axichat)

Axichat's stated goal is to replace your email, messenger, and calendar with one app.

**Best for:** someone who wants email, messaging, and calendar consolidated into a single app.

## D. Work & Habits

### [Meine Gleitzeit / My Flextime](/app/meine-gleitzeit-my-flextime)

This is a local app for tracking your working hours and flexitime.

**Best for:** tracking your own working hours and flextime balance.

### [Tickdroid](/app/tickdroid)

Tickdroid is a companion app for Tickbuddy, a daily habit tracker that runs on Nextcloud.

**Best for:** someone who already runs Tickbuddy on a Nextcloud instance.

## Comparison Table`;

const MULTIMEDIA = `"Multimedia" is one of the broadest labels a catalogue can use.

## How We Selected These Apps

A few ground rules shaped this list before any app made it in.

## Creation & Restoration

### [LibreCuts Beta](/app/librecuts-beta)

LibreCuts is a free, open-source, privacy-friendly video editor for Android.

**Best for:** editing video on-device, for someone willing to work with beta software.

### [FilmFlip](/app/filmflip)

FilmFlip does one very specific job: it captures film negatives with your phone's camera.

**Best for:** digitizing old film negatives with just a phone camera.

## Self-Hosted Streaming & Audiobooks

### [Tempus](/app/tempus)

Tempus describes itself as an open-source and privacy-focused music client for Subsonic.

**Best for:** someone who already runs a Subsonic-compatible music server.

### [Storii - audiobookshelf client](/app/storii-audiobookshelf-client)

Storii is a client for Audiobookshelf, with offline downloads and background playback.

**Best for:** someone already running Audiobookshelf.

## Recording, Tracking & Media Utilities

### [Diktafon: Voice Memos on Tape](/app/diktafon-voice-memos-on-tape)

Diktafon frames voice memos as cassette tapes, transcribed and summarised offline.

**Best for:** recording voice memos and getting an on-device transcript.

### [Seenema: Movie Tracker](/app/seenema-movie-tracker)

Seenema tracks and rates the films and shows you've watched.

**Best for:** keeping a personal log of what you've watched and rated.

### [LibreStatus](/app/librestatus)

LibreStatus lets you view, save and share statuses from WhatsApp, entirely offline.

**Best for:** saving and sharing WhatsApp statuses before they disappear.

## Live Media & Music Tools

### [FeedTV](/app/feedtv)

FeedTV brings together TV, radio and RSS news in one app.

**Best for:** someone who already has M3U playlists or RSS feeds.

### [Tuner](/app/tuner)

Tuner listens through your microphone and shows, in real time, how close each note is.

**Best for:** tuning an instrument with a clean, distraction-free interface.

### [Ambio: Focus Timer & Sounds](/app/ambio-focus-timer-sounds)

Ambio lets you blend up to 3 of 12 ambient sounds into a focus soundscape.

**Best for:** building a custom ambient soundscape for focus.

## Comparison Table`;

const INTERNET = `If you've spent any time looking for alternatives to the big-name Internet apps on your phone, you've probably noticed a pattern.

## How We Selected These Apps

A few ground rules shaped this list, worth stating plainly before the recommendations themselves.

## A. Privacy & Proxy Tools

### [FreeProxy](/app/freeproxy)

FreeProxy routes an individual app's traffic through a SOCKS5 or HTTP proxy that you configure.

**Best for:** someone who wants to route one particular app through a proxy.

### [Link Clear](/app/link-clear)

Link Clear does one job and does it plainly: it strips tracking parameters out of links.

**Best for:** anyone who shares links a lot and wants to quietly drop tracking parameters.

## B. Private & Alternative Messaging

### [SMSecure](/app/smsecure)

SMSecure is a privacy-focused SMS app built around encrypted conversations.

**Best for:** someone who wants their text conversations kept private.

### [Night Drop](/app/night-drop)

Night Drop is built specifically for 1:1 conversations that route over the Tor network.

**Best for:** a single private conversation where you specifically want Tor routing involved.

### [Knit](/app/knit)

Knit is genuinely unusual on this list: encrypted chat that works without an internet connection.

**Best for:** encrypted messaging with people nearby when there's no internet connection available.

### [Anonomi Messenger](/app/anonomi-messenger)

Anonomi Messenger describes itself as decentralized messaging built for high-threat environments.

**Best for:** someone specifically looking for a decentralized approach to messaging.

## C. Self-Hosted Internet Clients

### [Atrium](/app/atrium)

Atrium is a control client for a self-hosted media stack.

**Best for:** someone who already has a self-hosted media stack.

### [Folio](/app/folio)

Folio is an RSS reader built specifically for a self-hosted FreshRSS server.

**Best for:** someone who already runs FreshRSS.

## D. File Transfer

### [RelayPony](/app/relaypony)

RelayPony handles encrypted file transfer directly between two phones, without an account.

**Best for:** moving a file from one phone to another without routing it through a cloud service.

## E. Fediverse / Social Web

### [Skylib](/app/skylib)

Skylib is an alternative frontend for Bluesky, built so you can browse feeds and follows.

**Best for:** browsing Bluesky content without signing up for an account.

## Comparison Table`;

const PRIVACY_SECURITY = `"Privacy and security" isn't one problem with one app — it's a set of separate tasks.

This article describes what each app does and what its Android manifest requests. Where we note a permission an app *doesn't* request — most often \`INTERNET\` — that's a manifest fact.

## How We Selected These Apps

All ten come from GetApkFree's System category, which currently holds 37 published, F-Droid-sourced apps.

## A. Passwords & Authentication

### [1Key Password Manager](/app/1key-password-manager)

1Key's own listing describes an offline password manager with 2FA and notes support. No \`INTERNET\` permission is requested.

**Best for:** an offline password vault with built-in 2FA and notes.

### [Clockwork: 2FA Authenticator](/app/clockwork-2fa-authenticator)

Clockwork is a dedicated TOTP generator, kept separate from wherever you store your actual passwords.

**Best for:** keeping 2FA codes in a separate, focused app.

## B. File & Message Encryption

### [Neuron Encrypt](/app/neuron-encrypt)

Neuron Encrypt's own description is direct: local file encryption, no accounts, no internet.

**Best for:** encrypting individual files stored on the device.

### [Mage](/app/mage)

Mage is a GUI for \`age\`, a named file-encryption tool, rather than an in-house scheme.

**Best for:** encrypting files with the \`age\` format specifically.

### [Salty](/app/salty)

Salty's own listing describes it as "a secure, offline-first message encryption tool."

**Best for:** encrypting message text specifically, with the smallest permission footprint.

## C. Encrypted Storage & Network Privacy

### [Vault Explorer](/app/vault-explorer)

Vault Explorer is described as an encrypted container explorer supporting VeraCrypt, LUKS, BitLocker.

**Best for:** opening and browsing encrypted containers that already exist.

### [DNS Toggle](/app/dns-toggle)

DNS Toggle does what its name says: it lets you flip Android's built-in Private DNS setting on and off.

**Best for:** automating Android's Private DNS setting.

## D. Device & Profile Controls

### [Harbor](/app/harbor)

Harbor is described as local, FOSS work-profile isolation and app management.

**Best for:** separating a work profile from a personal one.

### [Neruppu](/app/neruppu)

Neruppu is described as offline-first physical security monitoring using device sensors.

**Best for:** monitoring a device's physical surroundings while it's unattended.

### [TapLock](/app/taplock)

TapLock does one thing: lock your screen instantly with a double tap.

**Best for:** locking your screen faster than the built-in method.

## Comparison Table`;

const NON_LISTICLE = `Before installing an APK, it's reasonable to want to know what the app inside it might ask to access.

## What Are APK Permissions?

A permission is Android's way of gating access to something sensitive.

## APK Permissions vs App Permissions

People commonly say "APK permissions," but strictly speaking, permissions belong to the installed application.

## Frequently Asked Questions

**What are APK permissions?**
Declarations in an APK's metadata describing what access the app wants.

## Final Thoughts

Permissions are useful information, not a safety score.`;

const EXPECTED = {
  games: [
    "sudoku",
    "wortm-hle",
    "astro-loop",
    "infra-arcana",
    "500-card-game",
    "cbg-clavierhaus-backgammon",
    "navy-fleet-battle",
    "diadem",
    "boardgame-pal",
    "eve-game-tracker",
  ],
  productivity: [
    "tallybook",
    "quits",
    "currency-converter",
    "forgetmenot",
    "saywhen",
    "malarm",
    "do-the-thing",
    "axichat",
    "meine-gleitzeit-my-flextime",
    "tickdroid",
  ],
  multimedia: [
    "librecuts-beta",
    "filmflip",
    "tempus",
    "storii-audiobookshelf-client",
    "diktafon-voice-memos-on-tape",
    "seenema-movie-tracker",
    "librestatus",
    "feedtv",
    "tuner",
    "ambio-focus-timer-sounds",
  ],
  internet: [
    "freeproxy",
    "link-clear",
    "smsecure",
    "night-drop",
    "knit",
    "anonomi-messenger",
    "atrium",
    "folio",
    "relaypony",
    "skylib",
  ],
  privacySecurity: [
    "1key-password-manager",
    "clockwork-2fa-authenticator",
    "neuron-encrypt",
    "mage",
    "salty",
    "vault-explorer",
    "dns-toggle",
    "harbor",
    "neruppu",
    "taplock",
  ],
};

group("extractListicleItems — real, published listicles (golden tests)", () => {
  test("A. best-open-source-games-android -> exactly 10, exact order", () => {
    const items = extractListicleItems(GAMES);
    assert.deepEqual(items.map((i) => i.slug), EXPECTED.games);
    assert.equal(items.length, 10);
  });

  test("B. best-open-source-productivity-apps-android -> exactly 10, exact order", () => {
    const items = extractListicleItems(PRODUCTIVITY);
    assert.deepEqual(items.map((i) => i.slug), EXPECTED.productivity);
    assert.equal(items.length, 10);
  });

  test("C. best-open-source-multimedia-apps-android -> exactly 10, exact order", () => {
    const items = extractListicleItems(MULTIMEDIA);
    assert.deepEqual(items.map((i) => i.slug), EXPECTED.multimedia);
    assert.equal(items.length, 10);
  });

  test("D. best-open-source-internet-networking-apps-android -> exactly 10, exact order", () => {
    const items = extractListicleItems(INTERNET);
    assert.deepEqual(items.map((i) => i.slug), EXPECTED.internet);
    assert.equal(items.length, 10);
  });

  test("E. best-open-source-privacy-security-apps-android -> exactly 10, exact order", () => {
    const items = extractListicleItems(PRIVACY_SECURITY);
    assert.deepEqual(items.map((i) => i.slug), EXPECTED.privacySecurity);
    assert.equal(items.length, 10);
  });

  test("names are preserved exactly, matching the visible heading text", () => {
    const items = extractListicleItems(PRIVACY_SECURITY);
    assert.equal(items[0].name, "1Key Password Manager");
    assert.equal(items[1].name, "Clockwork: 2FA Authenticator");
    assert.equal(items.at(-1)?.name, "TapLock");
  });

  test("F. a non-listicle post (what-are-apk-permissions-how-to-check) -> []", () => {
    assert.deepEqual(extractListicleItems(NON_LISTICLE), []);
  });
});

group("extractListicleItems — parsing rules and fail-closed behavior", () => {
  test("G. extraction stops at the first '## Comparison Table' heading", () => {
    const md = [
      "### [First App](/app/first-app)",
      "",
      "## Comparison Table",
      "",
      "| App |",
      "|---|",
      "| First App |",
      "",
      "### [Bonus App](/app/bonus-app)",
      "",
      "This should never be reached.",
    ].join("\n");
    const items = extractListicleItems(md);
    assert.equal(items.length, 1);
    assert.equal(items[0].slug, "first-app");
  });

  test("H. no '## Comparison Table' heading -> safe whole-document fallback", () => {
    const md = [
      "### [Only App](/app/only-app)",
      "",
      "Some prose about it.",
      "",
      "## Final Thoughts",
      "",
      "Closing text with no comparison table anywhere.",
    ].join("\n");
    const items = extractListicleItems(md);
    assert.equal(items.length, 1);
    assert.equal(items[0].slug, "only-app");
  });

  test("I. a prose-only /app/ link (not an H3 heading) is ignored", () => {
    const md = [
      "### [Real Entry](/app/real-entry)",
      "",
      "See also [Another App](/app/another-app) mentioned only in passing here.",
      "",
      "## Comparison Table",
    ].join("\n");
    const items = extractListicleItems(md);
    assert.equal(items.length, 1);
    assert.equal(items[0].slug, "real-entry");
  });

  test("J. a duplicate H3 app slug is deduped to its first occurrence", () => {
    const md = [
      "### [First Mention](/app/same-slug)",
      "",
      "### [Second Mention](/app/same-slug)",
      "",
      "## Comparison Table",
    ].join("\n");
    const items = extractListicleItems(md);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "First Mention");
  });

  test("L. determinism: calling it twice on the same input gives identical output", () => {
    assert.deepEqual(extractListicleItems(GAMES), extractListicleItems(GAMES));
  });

  test("a heading that is not a whole-line app link is not extracted", () => {
    const md = [
      "### Just a heading, no link at all",
      "",
      "### [App](/app/valid-one) with trailing text after the link",
      "",
      "## Comparison Table",
    ].join("\n");
    const items = extractListicleItems(md);
    // Neither line matches the strict "whole line is the link" pattern.
    assert.deepEqual(items, []);
  });

  test("an ordinary (non-app) H3 heading is ignored", () => {
    const md = ["### Camera", "", "Some ordinary prose subsection.", "", "## Comparison Table"].join(
      "\n",
    );
    assert.deepEqual(extractListicleItems(md), []);
  });

  test("does not parse anything from an empty or whitespace-only document", () => {
    assert.deepEqual(extractListicleItems(""), []);
    assert.deepEqual(extractListicleItems("   \n\n  "), []);
  });

  test("a document with only the Comparison Table heading and nothing before it -> []", () => {
    assert.deepEqual(extractListicleItems("## Comparison Table\n\nsome table\n"), []);
  });
});
