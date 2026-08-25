import Link from "next/link";

export const TABS = [
  { key: "account", label: "My Account" },
  { key: "downloads", label: "Downloaded Apps" },
  { key: "favorites", label: "Favorites" },
  { key: "settings", label: "Settings" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/** Sidebar on desktop; a horizontal scroller above the content on mobile. */
export default function ProfileNav({ active }: { active: TabKey }) {
  return (
    <nav aria-label="Profile sections" className="md:w-56 md:shrink-0">
      <ul className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:gap-1 md:overflow-visible md:pb-0">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key} className="shrink-0 md:shrink">
              <Link
                href={`/profile?tab=${tab.key}`}
                aria-current={isActive ? "page" : undefined}
                className={`block rounded-xl px-4 py-2.5 text-sm whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-brand-500/10 font-semibold text-brand-300"
                    : "text-fg-muted hover:bg-base-850 hover:text-fg"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
