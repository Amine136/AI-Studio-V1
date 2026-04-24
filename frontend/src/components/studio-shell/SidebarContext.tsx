"use client";

import { createContext, useContext, useMemo, useState } from "react";

type SidebarContextValue = {
  open: boolean;
  toggle: () => void;
  close: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function StudioSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  const value = useMemo(
    () => ({
      open,
      toggle: () => setOpen((prev) => !prev),
      close: () => setOpen(false),
    }),
    [open],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useStudioSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useStudioSidebar must be used within StudioSidebarProvider");
  }
  return context;
}
