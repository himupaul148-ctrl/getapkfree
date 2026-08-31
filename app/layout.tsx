import { Suspense } from "react";
import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import FavoritesProvider from "@/components/FavoritesProvider";
import SessionProvider from "@/components/SessionProvider";
import SiteFooter from "@/components/SiteFooter";
import { AdSense, Analytics } from "@/components/Analytics";
import PageViewTracker from "@/components/PageViewTracker";
import ThemeScript from "@/components/ThemeScript";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  // metadataBase lets every page use relative OG image paths and still emit
  // absolute URLs, which is what crawlers and link unfurlers require.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "GetApkFree — Free, Open-Source Android APK Downloads",
    template: "%s | " + SITE_NAME,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "APK download",
    "open source Android apps",
    "F-Droid mirror",
    "free Android apps",
    "safe APK",
  ],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_GB",
    url: SITE_URL,
    title: "GetApkFree — Free, Open-Source Android APK Downloads",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "GetApkFree — Free, Open-Source Android APK Downloads",
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
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
        {/* PageViewTracker reads the session for GA4's User-ID, so it has to
            sit inside the provider too. */}
        <SessionProvider>
          <FavoritesProvider>
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </FavoritesProvider>

          {/* Both render null unless their env var is set, so a deployment
              without them ships no third-party script at all. */}
          <Analytics />
          <AdSense />
          {/* useSearchParams() inside would otherwise pull the whole tree into
              client rendering and cost the static shell. */}
          <Suspense fallback={null}>
            <PageViewTracker />
          </Suspense>
        </SessionProvider>
      </body>
    </html>
  );
}
