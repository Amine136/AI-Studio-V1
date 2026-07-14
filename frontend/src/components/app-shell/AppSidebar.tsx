"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOutUser } from "../../lib/auth";
import { setTheme, useThemeMode } from "../../lib/theme";
import { useLanguage } from "../../context/LanguageContext";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  matchPrefix?: boolean;
  /** Shown in the mobile tab bar, where a cell is only ~72px wide. */
  shortLabel?: string;
};

// Primary destinations — these are the mobile tab bar. Five cells is the ceiling
// for a bottom bar at 360px; everything else lives behind "More".
const primaryItems: NavItem[] = [
  { href: "/playground", label: "Playground", icon: "auto_awesome" },
  // Packs has nested routes (/studio/packs/[id], .../batch) that must keep the
  // section highlighted, so it matches on prefix rather than exact href.
  { href: "/studio/packs", label: "Packs", icon: "grid_view", matchPrefix: true },
  { href: "/studio/create", label: "Smart Studio", icon: "art_track", shortLabel: "Studio" },
  { href: "/gallery", label: "Gallery", icon: "photo_library" },
];

// Secondary destinations — a second group on the desktop rail, the "More" sheet on mobile.
const secondaryItems: NavItem[] = [
  { href: "/credits", label: "Credits", icon: "account_balance_wallet" },
  { href: "/pricing", label: "Pricing", icon: "sell" },
  { href: "/settings", label: "Settings", icon: "tune" },
];

function isActive(item: NavItem, activePath: string) {
  return item.matchPrefix ? activePath.startsWith(item.href) : item.href === activePath;
}

export default function AppSidebar({ activePath, hideMobileNav = false }: { activePath: string; hideMobileNav?: boolean }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { t } = useLanguage();
  const theme = useThemeMode();

  const moreActive = secondaryItems.some((item) => isActive(item, activePath));

  // The sheet is a modal surface: Escape dismisses it, and the page behind it
  // must not scroll underneath.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [moreOpen]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutUser();
      router.replace("/auth");
    } finally {
      setSigningOut(false);
    }
  };

  const railLink = (item: NavItem) => {
    const active = isActive(item, activePath);
    return (
      <Link
        key={item.label}
        href={item.href}
        className={`flex items-center gap-2.5 rounded-md px-3 py-2 transition-colors duration-200 ${
          active
            ? "bg-[#1a2333] font-bold text-[#adc6ff] light:bg-[#3b82f6]/10 light:text-[#2563eb]"
            : "text-[#b9c8de]/70 hover:bg-[#1a2333] hover:text-[#adc6ff] light:text-slate-500 light:hover:bg-slate-900/[0.04] light:hover:text-[#2563eb]"
        }`}
      >
        <span
          className="material-symbols-outlined text-[20px]"
          style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          {item.icon}
        </span>
        <span>{t(item.label)}</span>
      </Link>
    );
  };

  return (
    <>
      <aside className="fixed start-0 top-0 hidden h-screen w-48 flex-col border-e border-white/6 bg-[linear-gradient(180deg,#1a2333_0%,#0c1324_100%)] px-3 py-5 light:border-slate-900/10 light:bg-white light:bg-none lg:flex">
        <div className="mb-6 px-2">
          <div className="flex items-center gap-2">
            <img
              src="/best-version/logo-192.png?v=20260506-1210"
              alt="Vibecraft logo"
              className="h-8 w-8 object-contain"
            />
            <h1 className="font-headline text-xl font-bold tracking-tighter text-[#adc6ff] light:text-[#3b82f6]">Vibecraft</h1>
          </div>
          <p className="mt-1 text-xs uppercase tracking-[0.28em] text-[#b9c8de]/70 light:text-slate-500">{t("Workspace")}</p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto font-headline text-sm tracking-wide">
          {primaryItems.map(railLink)}
          <div className="!my-3 h-px bg-white/[0.07] light:bg-slate-900/10" />
          {secondaryItems.map(railLink)}
        </nav>

        <div className="mt-auto shrink-0 space-y-1 border-t border-white/10 pt-4 font-headline text-sm tracking-wide light:border-slate-900/10">
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[#b9c8de]/70 transition-colors hover:bg-[#1a2333] hover:text-[#adc6ff] light:text-slate-500 light:hover:bg-slate-900/[0.04] light:hover:text-slate-900"
          >
            <span className="material-symbols-outlined text-[20px]">{theme === "dark" ? "light_mode" : "dark_mode"}</span>
            <span>{theme === "dark" ? t("Light Mode") : t("Dark Mode")}</span>
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[#b9c8de]/70 transition-colors hover:bg-[#1a2333] hover:text-[#adc6ff] light:text-slate-500 light:hover:bg-slate-900/[0.04] light:hover:text-slate-900"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span>{signingOut ? t("Signing Out...") : t("Sign Out")}</span>
          </button>
        </div>
      </aside>

      {hideMobileNav ? null : (
        <>
          {/* Mobile tab bar. Its height is --app-nav-h plus the gesture-bar inset,
              so pages reserve clearance with .app-nav-clear rather than guessing. */}
          <nav className="app-bottom-nav lg:hidden">
            {primaryItems.map((item) => {
              const active = isActive(item, activePath);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`app-bottom-nav__item ${active ? "app-bottom-nav__item--active" : ""}`}
                >
                  <span
                    className="material-symbols-outlined text-[22px]"
                    style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {item.icon}
                  </span>
                  <span className="app-bottom-nav__label">{t(item.shortLabel || item.label)}</span>
                </Link>
              );
            })}

            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`app-bottom-nav__item ${moreActive || moreOpen ? "app-bottom-nav__item--active" : ""}`}
            >
              <span
                className="material-symbols-outlined text-[22px]"
                style={moreActive || moreOpen ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                more_horiz
              </span>
              {/* t("Menu"), not t("More"): the "More" key is a quantity word used by
                  Credits ("Show 5 More" → fr "de plus") and reads wrong as a tab. */}
              <span className="app-bottom-nav__label">{t("Menu")}</span>
            </button>
          </nav>

          {moreOpen ? (
            <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label={t("Menu")}>
              <button type="button" aria-label={t("Close")} onClick={() => setMoreOpen(false)} className="app-sheet__scrim" />
              <div className="app-sheet">
                <div className="app-sheet__grab" aria-hidden="true" />
                <div className="space-y-1">
                  {secondaryItems.map((item) => {
                    const active = isActive(item, activePath);
                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={() => setMoreOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={`app-sheet__row ${active ? "app-sheet__row--active" : ""}`}
                      >
                        <span
                          className="material-symbols-outlined text-[21px]"
                          style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                        >
                          {item.icon}
                        </span>
                        <span>{t(item.label)}</span>
                      </Link>
                    );
                  })}
                </div>

                <div className="my-2 h-px bg-white/[0.07] light:bg-slate-900/10" />

                <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="app-sheet__row w-full">
                  <span className="material-symbols-outlined text-[21px]">{theme === "dark" ? "light_mode" : "dark_mode"}</span>
                  <span>{theme === "dark" ? t("Light Mode") : t("Dark Mode")}</span>
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
