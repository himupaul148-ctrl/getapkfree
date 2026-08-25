import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";
import { LogoMark } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your GetApkFree account.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/profile", error } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <div className="flex justify-center">
        <LogoMark size={44} />
      </div>
      <h1 className="mt-5 text-center text-3xl font-extrabold tracking-tight">
        Welcome back
      </h1>
      <p className="mt-2 text-center text-fg-muted">
        Sign in to sync your favourites and download history.
      </p>

      <div className="mt-8">
        <AuthForm mode="login" next={next} initialError={error} />
      </div>
    </div>
  );
}
