import UploadForm from "@/components/admin/UploadForm";

export const dynamic = "force-dynamic";

export default function AdminUploadPage() {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Upload a build</h2>
      <p className="mt-1 text-sm text-fg-muted">
        The APK goes to storage first, then its manifest fills in what it can.
      </p>
      <div className="mt-6">
        <UploadForm />
      </div>
    </div>
  );
}
