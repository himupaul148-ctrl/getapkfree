"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EditMetadataModal, {
  type EditableApp,
} from "@/components/admin/EditMetadataModal";
import { useSession } from "@/components/SessionProvider";

export default function AdminAppEditButton({ app }: { app: EditableApp }) {
  const { status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (status !== "admin") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-brand-500/40 bg-brand-500/10 px-3.5 py-2.5 text-sm font-medium text-brand-300 transition-colors hover:border-brand-500/60 hover:bg-brand-500/20 hover:text-brand-200"
        aria-label={"Edit " + app.name}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m14.5 5.5 4 4M4 20l3.8-.8L19.7 7.3a2.1 2.1 0 0 0-3-3L4.8 16.2 4 20Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Edit App
      </button>

      {open && (
        <EditMetadataModal
          app={app}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
