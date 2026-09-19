"use client";

import { createContext, useContext, useState } from "react";

type Overlay = "search" | "more" | null;

type MobileUiValue = {
  overlay: Overlay;
  openSearch: () => void;
  openMore: () => void;
  close: () => void;
};

const MobileUiContext = createContext<MobileUiValue | null>(null);

export function useMobileUi(): MobileUiValue {
  const value = useContext(MobileUiContext);
  if (!value) throw new Error("useMobileUi must be used inside <MobileUiProvider>");
  return value;
}

/**
 * One piece of state for the two full-screen mobile overlays (search, and
 * the bottom nav's "More" sheet) — both SiteHeader's search icon and
 * MobileBottomNav's Search tab open the same overlay, and only one overlay
 * can be open at a time, so a single `Overlay | null` covers it instead of
 * two independent booleans that could disagree.
 */
export default function MobileUiProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [overlay, setOverlay] = useState<Overlay>(null);

  return (
    <MobileUiContext.Provider
      value={{
        overlay,
        openSearch: () => setOverlay("search"),
        openMore: () => setOverlay("more"),
        close: () => setOverlay(null),
      }}
    >
      {children}
    </MobileUiContext.Provider>
  );
}
