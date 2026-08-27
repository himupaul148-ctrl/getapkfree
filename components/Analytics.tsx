import Script from "next/script";
import { ADSENSE_CLIENT, GA_ID, adsEnabled, analyticsEnabled } from "@/lib/site-config";

/**
 * Google Analytics 4.
 *
 * Renders nothing at all unless NEXT_PUBLIC_GA_ID is set, so a deployment
 * without the variable ships no third-party script and the privacy policy's
 * analytics section — which reads the same flag — stays accurate.
 *
 * `afterInteractive` keeps the tag off the critical path; analytics is never
 * worth delaying first paint for.
 */
export function Analytics() {
  if (!analyticsEnabled) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}

/**
 * The AdSense loader. Placing units on the page is a separate step — this only
 * loads the script Google needs in order to serve them, which is also what its
 * site review looks for.
 */
export function AdSense() {
  if (!adsEnabled) return null;

  return (
    <Script
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      strategy="afterInteractive"
      crossOrigin="anonymous"
    />
  );
}
