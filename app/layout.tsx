import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import FavoritesProvider from "@/components/FavoritesProvider";
import SiteFooter from "@/components/SiteFooter";
import ThemeScript from "@/components/ThemeScript";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GetApkFree — free, open-source Android apps, safe and scanned",
    template: "%s · GetApkFree",
  },
  description:
    "Download legitimate APKs with confidence. Every build is versioned, malware-scanned, and published with its full changelog.",
};

/**
 * Deliberately synchronous and cookie-free. Awaiting the profile here made the
 * root layout dynamic, which cascades to every route: no ISR anywhere and a
 * "private, no-cache" header on every response, so no CDN could cache a thing.
 * SiteHeader resolves the session in the browser instead.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-brand-500 focus:px-4 focus:py-2 focus:font-semibold focus:text-base-950"
        >
          Skip to content
        </a>
        <FavoritesProvider>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </FavoritesProvider>
      </body>
    </html>
  );
}
