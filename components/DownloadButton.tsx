"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { track } from "@/lib/gtag";

/**
 * Records the download, then follows the link. The insert is allowed for
 * anonymous visitors too (user_id stays null), and a database trigger bumps
 * apps.download_count from the same row — so the counter and the event log
 * can never drift apart.
 *
 * `external` listings send people to the official publisher instead of an APK
 * we link directly. Those open in a new tab and carry noopener, because the
 * destination is a third party rather than F-Droid's repo.
 */
export default function DownloadButton({
  versionId,
  versionName,
  fileUrl,
  variant = "primary",
  external = false,
  appName,
  appCategory = null,
  children,
}: {
  versionId: string;
  versionName: string;
  fileUrl: string | null;
  variant?: "primary" | "link";
  external?: boolean;
  /** Analytics only — the download itself does not need them. */
  appName?: string;
  appCategory?: string | null;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function record(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return; // let the browser handle it
    event.preventDefault();
    if (pending) return;
    setPending(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase
      .from("downloads")
      .insert({ version_id: versionId, user_id: user?.id ?? null });

    if (appName) {
      track("app_download", {
        app_name: appName,
        app_category: appCategory,
        version: versionName || null,
      });
    }

    router.refresh(); // pick up the new download count
    setPending(false);

    if (!fileUrl) return;
    if (external) {
      window.open(fileUrl, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = fileUrl;
    }
  }

  const outboundProps = external
    ? { target: "_blank", rel: "noopener noreferrer nofollow" }
    : {};

  if (variant === "link") {
    return (
      <a
        href={fileUrl ?? "#"}
        onClick={record}
        {...outboundProps}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-400 hover:underline"
      >
        <Arrow size={14} external={external} />
        {children ?? `Download v${versionName}`}
      </a>
    );
  }

  return (
    <a
      href={fileUrl ?? "#"}
      onClick={record}
      {...outboundProps}
      className="inline-flex flex-1 items-center justify-center gap-2.5 rounded-2xl bg-brand-500 px-6 py-4 text-base font-bold text-base-950 transition-colors hover:bg-brand-400 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none"
    >
      <Arrow size={20} external={external} />
      {children ?? `Download Latest Version (v${versionName})`}
    </a>
  );
}

function Arrow({ size, external }: { size: number; external?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={
          external
            ? "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
            : "M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"
        }
        stroke="currentColor"
        strokeWidth={size > 16 ? 2.2 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
