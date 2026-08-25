import type { Metadata } from "next";
import Link from "next/link";
import AuthForm from "@/components/AuthForm";
import { LogoMark } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create a GetApkFree account.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = "/profile" } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <div className="flex justify-center">
        <LogoMark size={44} />
      </div>
      <h1 className="mt-5 text-center text-3xl font-extrabold tracking-tight">
        Create an account
      </h1>
      <p className="mt-2 text-center text-fg-muted">
        Save favourites and keep a download history. Browsing never requires an
        account.
      </p>

      <div className="mt-8">
        <AuthForm mode="signup" next={next} />
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-fg-dim">
        We store your email and username, nothing else. See the{" "}
        <Link href="/privacy" className="text-brand-400 hover:underline">
          privacy page
        </Link>
        .
      </p>
    </div>
  );
}
