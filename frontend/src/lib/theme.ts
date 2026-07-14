"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "vc-theme";
const CHANGE_EVENT = "vc-theme-change";

export function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyThemeToDocument(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
}

export function setTheme(theme: ThemeMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing: theme still applies for this page view.
  }
  applyThemeToDocument(theme);
  window.dispatchEvent(new CustomEvent<ThemeMode>(CHANGE_EVENT, { detail: theme }));
}

export function useThemeMode(): ThemeMode {
  // Starts as "dark" on the server render; corrected after mount so SSR
  // markup never mismatches.
  const [theme, setThemeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    setThemeState(readStoredTheme());
    const onChange = (event: Event) => {
      setThemeState((event as CustomEvent<ThemeMode>).detail);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  return theme;
}
