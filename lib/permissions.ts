/**
 * Plain-English descriptions for the Android permissions we surface. A raw
 * `android.permission.QUERY_ALL_PACKAGES` tells a reader nothing about what the
 * app can actually do, which is the whole point of showing the list.
 */
const DESCRIPTIONS: Record<string, string> = {
  INTERNET: "Send and receive data over the internet.",
  ACCESS_NETWORK_STATE: "See whether you are online and on which type of network.",
  READ_EXTERNAL_STORAGE: "Read files you have stored on the device.",
  WRITE_EXTERNAL_STORAGE: "Create and modify files on shared storage.",
  READ_MEDIA_AUDIO: "Read audio files in your library.",
  READ_MEDIA_IMAGES: "Read photos and images in your library.",
  POST_NOTIFICATIONS: "Show notifications.",
  VIBRATE: "Use the vibration motor.",
  WAKE_LOCK: "Keep the device awake while working in the background.",
  FOREGROUND_SERVICE: "Keep running in the background with a visible notification.",
  CAMERA: "Use the camera to take photos or video.",
  RECORD_AUDIO: "Record audio using the microphone.",
  PACKAGE_USAGE_STATS: "See which apps you use and for how long.",
  SYSTEM_ALERT_WINDOW: "Draw over other apps.",
  QUERY_ALL_PACKAGES: "See the full list of apps installed on the device.",
  BATTERY_STATS: "Read detailed battery usage statistics.",
};

/**
 * Permissions worth a second look before installing: they expose personal data
 * or let an app reach outside its own sandbox.
 */
const SENSITIVE = new Set([
  "CAMERA",
  "RECORD_AUDIO",
  "PACKAGE_USAGE_STATS",
  "SYSTEM_ALERT_WINDOW",
  "QUERY_ALL_PACKAGES",
  "WRITE_EXTERNAL_STORAGE",
]);

export type PermissionInfo = {
  raw: string;
  short: string;
  label: string;
  description: string;
  sensitive: boolean;
};

export function describePermission(raw: string): PermissionInfo {
  const short = raw.split(".").pop() ?? raw;
  return {
    raw,
    short,
    label: short
      .toLowerCase()
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" "),
    description: DESCRIPTIONS[short] ?? "No description available for this permission.",
    sensitive: SENSITIVE.has(short),
  };
}

/** Sensitive permissions sort to the top so they are not buried in the list. */
export function describePermissions(raws: string[]): PermissionInfo[] {
  return raws
    .map(describePermission)
    .sort((a, b) =>
      a.sensitive === b.sensitive
        ? a.label.localeCompare(b.label)
        : a.sensitive
          ? -1
          : 1,
    );
}
