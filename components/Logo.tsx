/**
 * GetApkFree mark, rebuilt as inline SVG from the supplied logo artwork:
 * a green gradient shopping bag carrying an Android head over an "APK" label.
 * Inline so it scales cleanly and costs no extra network request.
 */
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="GetApkFree"
    >
      <defs>
        <linearGradient id="gaf-bag" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
      </defs>

      {/* bag handle */}
      <path
        d="M23 17a9 9 0 0 1 18 0"
        stroke="#22c55e"
        strokeWidth="3.2"
        strokeLinecap="round"
      />

      {/* bag body */}
      <rect x="10" y="16" width="44" height="38" rx="6" fill="url(#gaf-bag)" />

      {/* android antennae */}
      <path
        d="m26 25-2.6-4.2M38 25l2.6-4.2"
        stroke="#ffffff"
        strokeWidth="2.1"
        strokeLinecap="round"
      />

      {/* android head */}
      <path d="M22 35a10 10 0 0 1 20 0z" fill="#ffffff" />
      <circle cx="28" cy="30.4" r="1.5" fill="#16a34a" />
      <circle cx="36" cy="30.4" r="1.5" fill="#16a34a" />

      {/* APK label */}
      <rect x="17" y="37" width="30" height="12.5" rx="2.5" fill="#ffffff" />
      <text
        x="32"
        y="46.4"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="700"
        letterSpacing="0.4"
        fill="#16a34a"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        APK
      </text>
    </svg>
  );
}

export function LogoWordmark() {
  return (
    <span className="text-xl font-extrabold tracking-tight text-fg">
      get<span className="text-brand-500">apk</span>free
      <span className="text-fg-dim">.com</span>
    </span>
  );
}

export default function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <LogoWordmark />
    </span>
  );
}
