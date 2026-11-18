import sharp from "sharp";

const faviconSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 64 64">
  <rect x="10" y="16" width="44" height="38" rx="6" fill="#22c55e"/>
  <path d="M23 17a9 9 0 0 1 18 0" fill="none" stroke="#16a34a" stroke-width="3.2" stroke-linecap="round"/>
  <path d="m26 25-2.6-4.2M38 25l2.6-4.2" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/>
  <path d="M22 35a10 10 0 0 1 20 0z" fill="#fff"/>
  <circle cx="28" cy="30.4" r="1.5" fill="#16a34a"/><circle cx="36" cy="30.4" r="1.5" fill="#16a34a"/>
  <rect x="17" y="37" width="30" height="12.5" rx="2.5" fill="#fff"/>
  <text x="32" y="46.4" text-anchor="middle" font-size="9.5" font-weight="700" letter-spacing=".4" fill="#16a34a" font-family="Arial,sans-serif">APK</text>
</svg>`);

export async function GET() {
  const png = await sharp(faviconSvg).png().resize(96, 96).toBuffer();
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
