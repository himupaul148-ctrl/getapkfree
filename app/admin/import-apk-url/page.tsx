import ImportApkUrlForm from "@/components/admin/ImportApkUrlForm";

export const dynamic = "force-dynamic";

export default function ImportApkUrlPage() {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Import APK from URL</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Download an APK from a trusted HTTPS URL, validate it, and add it to
        GetApkFree.
      </p>
      <div className="mt-6">
        <ImportApkUrlForm />
      </div>
    </div>
  );
}
