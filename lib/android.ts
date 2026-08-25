/**
 * Android API level -> the release number the site shows. Shared by the admin
 * upload form and the F-Droid importer so both agree on what "Android 9.0"
 * means; without this they would drift apart silently.
 */
export const API_TO_RELEASE: Record<number, string> = {
  16: "4.1", 17: "4.2", 18: "4.3", 19: "4.4", 20: "4.4",
  21: "5.0", 22: "5.1", 23: "6.0", 24: "7.0", 25: "7.1",
  26: "8.0", 27: "8.1", 28: "9.0", 29: "10.0", 30: "11.0",
  31: "12.0", 32: "12.1", 33: "13.0", 34: "14.0", 35: "15.0",
  36: "16.0",
};

/** Unknown levels fall back to the raw number rather than dropping the value. */
export function releaseFromApiLevel(level: unknown): string | null {
  const api = Number(level);
  if (!Number.isFinite(api) || api <= 0) return null;
  return API_TO_RELEASE[api] ?? String(api);
}
