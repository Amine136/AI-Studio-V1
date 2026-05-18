"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOutUser } from "../../lib/auth";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/studio", label: "Studio", icon: "auto_awesome" },
  { href: "/gallery", label: "Gallery", icon: "photo_library" },
  { href: "/credits", label: "Credits", icon: "account_balance_wallet" },
  { href: "/pricing", label: "Pricing", icon: "payments" },
  { href: "/settings", label: "Settings", icon: "tune" },
];

export default function AppSidebar({ activePath, hideMobileNav = false }: { activePath: string; hideMobileNav?: boolean }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

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

  return (
    <>
      <aside className="fixed left-0 top-0 hidden h-screen w-48 flex-col border-r border-white/6 bg-[linear-gradient(180deg,#1a2333_0%,#0c1324_100%)] px-3 py-8 lg:flex">
        <div className="mb-10 px-2">
          <div className="flex items-center gap-2">
            <img
              src="/best-version/logo-192.png?v=20260506-1210"
              alt="Vibecraft logo"
              className="h-8 w-8 object-contain"
            />
            <h1 className="font-headline text-xl font-bold tracking-tighter text-[#adc6ff]">Vibecraft</h1>
          </div>
          <p className="mt-1 text-xs uppercase tracking-[0.28em] text-[#b9c8de]/70">Workspace</p>
        </div>

        <nav className="flex-1 space-y-2 font-headline text-sm tracking-wide">
          {navItems.map((item) => {
            const active = item.href === activePath;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-3 transition-colors duration-200 ${
                  active
                    ? "bg-[#1a2333] font-bold text-[#adc6ff]"
                    : "text-[#b9c8de]/70 hover:bg-[#1a2333] hover:text-[#adc6ff]"
                }`}
              >
                <span
                  className="material-symbols-outlined"
                  style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2 border-t border-white/10 pt-8">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[#b9c8de]/70 transition-colors hover:bg-[#1a2333]"
          >
            <span className="material-symbols-outlined">logout</span>
            <span>{signingOut ? "Signing Out..." : "Sign Out"}</span>
          </button>
        </div>
      </aside>

      {hideMobileNav ? null : (
        <nav className="fixed bottom-0 left-0 z-50 grid h-20 w-full grid-cols-6 items-center border-t border-white/10 bg-slate-900/95 px-2 backdrop-blur-xl lg:hidden">
          {navItems.map((item) => {
            const active = item.href === activePath;
            return (
              <Link key={item.label} href={item.href} className={`flex min-w-0 flex-col items-center gap-1 ${active ? "text-blue-300" : "text-slate-500"}`}>
                <span
                  className="material-symbols-outlined"
                  style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {item.icon}
                </span>
                <span className="truncate text-[9px] font-bold uppercase tracking-tighter">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
