"use client";

import Link from "next/link";
import { useState } from "react";
import AppIcon from "@/components/AppIcon";
import { formatDate, formatRelative } from "@/lib/format";
import {
  describeOutcome,
  fieldLabel,
  filterProposals,
  formatFieldValue,
  type PostActionResult,
} from "@/lib/metadata/play-proposals-ui";

export type ManagedProposal = {
  id: string;
  proposalType: "new_app" | "metadata_update";
  packageName: string;
  playUrl: string;
  appId: string | null;
  proposedFields: Record<string, unknown>;
  previousFields: Record<string, unknown> | null;
  createdAt: string;
  /** Only present for metadata_update, and only if the app still exists. */
  appSlug: string | null;
  appName: string | null;
  manualFields: string[];
};

type ConfirmAction = { proposal: ManagedProposal; action: "approve" | "reject" };

/**
 * Phase 4e: the admin review UI for public.play_import_proposals.
 *
 * This component never writes to the database itself — every Approve/Reject
 * click calls the existing Phase 4d API routes
 * (app/api/admin/play-proposals/[id]/{approve,reject}), which are the only
 * things that ever touch apps/versions/play_import_proposals. Approve sends
 * an empty body (the id in the URL is the only input); reject sends only an
 * optional `{ reason }` — neither ever sends a proposal's own field data
 * back to the server, since the server always re-reads and re-diffs live
 * state itself (see lib/metadata/play-proposal-approval.ts).
 */
export default function PlayProposalsReview({
  proposals: initialProposals,
}: {
  proposals: ManagedProposal[];
}) {
  const [proposals, setProposals] = useState(initialProposals);
  const [filter, setFilter] = useState<"all" | "new_app" | "metadata_update">("all");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const newAppCount = proposals.filter((p) => p.proposalType === "new_app").length;
  const metadataUpdateCount = proposals.filter((p) => p.proposalType === "metadata_update").length;

  const visible = filterProposals(proposals, filter);

  function removeProposal(id: string) {
    setProposals((current) => current.filter((p) => p.id !== id));
  }

  async function postAction(url: string, body?: Record<string, unknown>): Promise<PostActionResult> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = await res.json();
      } catch {
        /* no body */
      }
      return { networkError: false, status: res.status, body: parsed };
    } catch {
      return { networkError: true };
    }
  }

  async function runApprove(proposal: ManagedProposal) {
    setBusyId(proposal.id);
    setError(null);
    setSuccess(null);
    // Empty body — the proposal id in the URL is the only input this ever sends.
    const result = await postAction(`/api/admin/play-proposals/${proposal.id}/approve`);
    setBusyId(null);
    setConfirmAction(null);

    const outcome = describeOutcome(result);
    if (outcome.kind === "success") {
      setSuccess(
        proposal.proposalType === "new_app"
          ? `Approved — created a metadata-only draft for "${(proposal.proposedFields.name as string) ?? proposal.packageName}". No version or download exists yet.`
          : `Approved — metadata updated for "${proposal.appName ?? proposal.packageName}".`,
      );
    } else {
      setError(outcome.message);
    }
    if (outcome.removeFromList) removeProposal(proposal.id);
  }

  async function runReject(proposal: ManagedProposal, reason: string) {
    setBusyId(proposal.id);
    setError(null);
    setSuccess(null);
    const trimmed = reason.trim();
    const result = await postAction(
      `/api/admin/play-proposals/${proposal.id}/reject`,
      trimmed ? { reason: trimmed } : undefined,
    );
    setBusyId(null);
    setConfirmAction(null);
    setRejectReason("");

    const outcome = describeOutcome(result);
    if (outcome.kind === "success") {
      setSuccess(`Rejected the proposal for "${proposal.appName ?? proposal.packageName}".`);
    } else {
      setError(outcome.message);
    }
    if (outcome.removeFromList) removeProposal(proposal.id);
  }

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-xl border border-brand-500/40 bg-brand-500/10 px-4 py-3 text-sm text-brand-300">
          {success}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          aria-label="Filter by proposal type"
          className="rounded-xl border border-base-700 bg-base-850 px-3.5 py-2 text-sm text-fg focus:border-brand-500 focus:outline-none"
        >
          <option value="all">All pending ({proposals.length})</option>
          <option value="new_app">New apps ({newAppCount})</option>
          <option value="metadata_update">Metadata updates ({metadataUpdateCount})</option>
        </select>
        <span className="text-xs text-fg-dim">
          Showing {visible.length} of {proposals.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-base-800 bg-base-900 p-8 text-center text-fg-muted">
          {proposals.length === 0
            ? "No pending proposals — everything has been reviewed."
            : "No proposals match that filter."}
        </p>
      ) : (
        <ul className="space-y-4">
          {visible.map((proposal) => (
            <li key={proposal.id}>
              {proposal.proposalType === "new_app" ? (
                <NewAppCard
                  proposal={proposal}
                  busy={busyId === proposal.id}
                  onApprove={() => setConfirmAction({ proposal, action: "approve" })}
                  onReject={() => setConfirmAction({ proposal, action: "reject" })}
                />
              ) : (
                <MetadataUpdateCard
                  proposal={proposal}
                  busy={busyId === proposal.id}
                  onApprove={() => setConfirmAction({ proposal, action: "approve" })}
                  onReject={() => setConfirmAction({ proposal, action: "reject" })}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {confirmAction && (
        <ConfirmModal
          confirmAction={confirmAction}
          reason={rejectReason}
          onReasonChange={setRejectReason}
          busy={busyId === confirmAction.proposal.id}
          onCancel={() => {
            setConfirmAction(null);
            setRejectReason("");
          }}
          onConfirm={() => {
            if (confirmAction.action === "approve") runApprove(confirmAction.proposal);
            else runReject(confirmAction.proposal, rejectReason);
          }}
        />
      )}
    </div>
  );
}

function ProposalMeta({ playUrl, createdAt }: { playUrl: string; createdAt: string }) {
  return (
    <p className="mt-2 text-xs text-fg-dim">
      Proposed {formatRelative(createdAt)} ({formatDate(createdAt)}) ·{" "}
      <a href={playUrl} target="_blank" rel="noreferrer" className="text-azure-400 hover:underline">
        View on Google Play
      </a>
    </p>
  );
}

function ActionButtons({
  busy,
  onApprove,
  onReject,
}: {
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={onApprove}
        disabled={busy}
        className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-base-950 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Working…" : "Approve"}
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={busy}
        className="rounded-xl border border-base-700 px-4 py-2 text-sm text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Working…" : "Reject"}
      </button>
    </div>
  );
}

function NewAppCard({
  proposal,
  busy,
  onApprove,
  onReject,
}: {
  proposal: ManagedProposal;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const f = proposal.proposedFields;
  const name = (f.name as string | undefined) ?? proposal.packageName;
  const rating = f.rating as number | null | undefined;
  const ratingCount = f.rating_count as number | null | undefined;

  return (
    <div className="rounded-2xl border border-base-800 bg-base-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-4">
          <AppIcon src={(f.icon_url as string | null) ?? null} name={name} size={56} />
          <div className="min-w-0">
            <h3 className="font-semibold text-fg">{name}</h3>
            <p className="text-sm text-fg-dim">{(f.developer_name as string | null) ?? "Unknown developer"}</p>
            {f.category ? (
              <span className="mt-1.5 inline-block rounded-full border border-base-700 px-2.5 py-0.5 text-xs text-fg-muted">
                {String(f.category)}
              </span>
            ) : null}
          </div>
        </div>
        <span className="rounded-full bg-azure-500/10 px-2.5 py-1 text-xs font-medium text-azure-300">New app</span>
      </div>

      {f.description ? (
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">{String(f.description)}</p>
      ) : (
        <p className="mt-3 text-sm text-fg-dim">No description available.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-dim">
        <span>{rating != null ? `★ ${rating.toFixed(2)} (${formatFieldValue("rating_count", ratingCount)} ratings)` : "No rating available"}</span>
        <span className="font-mono">{proposal.packageName}</span>
      </div>

      <ProposalMeta playUrl={proposal.playUrl} createdAt={proposal.createdAt} />

      <p className="mt-4 rounded-xl border border-azure-500/25 bg-azure-500/5 p-3 text-xs leading-relaxed text-azure-300">
        Metadata-only draft — no APK or version exists yet.
      </p>
      <p className="mt-2 text-xs text-fg-dim">Approving this proposal does NOT create a download or APK.</p>

      <ActionButtons busy={busy} onApprove={onApprove} onReject={onReject} />
    </div>
  );
}

function MetadataUpdateCard({
  proposal,
  busy,
  onApprove,
  onReject,
}: {
  proposal: ManagedProposal;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const fields = Object.keys(proposal.proposedFields);

  return (
    <div className="rounded-2xl border border-base-800 bg-base-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {proposal.appSlug ? (
            <Link href={`/app/${proposal.appSlug}`} className="font-semibold text-fg hover:text-brand-400">
              {proposal.appName ?? proposal.packageName}
            </Link>
          ) : (
            <h3 className="font-semibold text-fg">{proposal.appName ?? proposal.packageName}</h3>
          )}
          <p className="font-mono text-xs text-fg-dim">{proposal.packageName}</p>
        </div>
        <span className="rounded-full bg-base-800 px-2.5 py-1 text-xs font-medium text-fg-muted">Metadata update</span>
      </div>

      <div className="mt-4 space-y-2">
        {fields.map((field) => (
          <div key={field} className="rounded-xl border border-base-800 bg-base-950 p-3">
            <p className="text-xs font-medium text-fg-dim">{fieldLabel(field)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-fg-muted">{formatFieldValue(field, proposal.previousFields?.[field])}</span>
              <span className="text-fg-dim" aria-hidden="true">
                →
              </span>
              <span className="font-medium text-brand-400">{formatFieldValue(field, proposal.proposedFields[field])}</span>
            </div>
          </div>
        ))}
      </div>

      {proposal.manualFields.length > 0 && (
        <p className="mt-3 text-xs text-fg-dim">
          Manually protected — will NOT change: {proposal.manualFields.map(fieldLabel).join(", ")}.
        </p>
      )}

      <ProposalMeta playUrl={proposal.playUrl} createdAt={proposal.createdAt} />

      <ActionButtons busy={busy} onApprove={onApprove} onReject={onReject} />
    </div>
  );
}

function ConfirmModal({
  confirmAction,
  reason,
  onReasonChange,
  busy,
  onCancel,
  onConfirm,
}: {
  confirmAction: ConfirmAction;
  reason: string;
  onReasonChange: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { proposal, action } = confirmAction;
  const label = proposal.appName ?? proposal.packageName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${action === "approve" ? "Approve" : "Reject"} proposal for ${label}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-base-700 bg-base-900 p-6"
      >
        <h3 className="text-lg font-bold">
          {action === "approve" ? "Approve" : "Reject"} this proposal?
        </h3>

        {action === "approve" ? (
          <p className="mt-3 text-sm leading-relaxed text-fg-muted">
            {proposal.proposalType === "new_app"
              ? "Approve this Play metadata draft? This will create a metadata-only app record. No version or download will be created."
              : "Approve these metadata changes? Current values will be rechecked before applying."}
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">
              Rejecting this proposal marks it declined — it will not be applied.
            </p>
            <label htmlFor="reject-reason" className="mt-4 block text-sm font-medium">
              Reason (optional)
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              rows={3}
              placeholder="Why is this being rejected?"
              className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
              action === "approve"
                ? "bg-brand-500 text-base-950 hover:bg-brand-400"
                : "bg-rose-500 text-base-950 hover:bg-rose-400"
            }`}
          >
            {busy ? "Working…" : action === "approve" ? "Approve" : "Reject"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-base-700 px-4 py-2.5 text-sm text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
