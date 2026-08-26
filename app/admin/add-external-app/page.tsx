import ExternalAppForm from "@/components/admin/ExternalAppForm";

export const dynamic = "force-dynamic";

export default function AddExternalAppPage() {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Add an external app</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Lists an app we do not host. Paste the official link, check what came
        back, and the download button will redirect there.
      </p>
      <div className="mt-6">
        <ExternalAppForm />
      </div>
    </div>
  );
}
