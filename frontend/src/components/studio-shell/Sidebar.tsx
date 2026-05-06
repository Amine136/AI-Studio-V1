"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useStudioSidebar } from "./SidebarContext";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/studio", label: "Studio", icon: "auto_awesome" },
  { href: "/gallery", label: "Gallery", icon: "photo_library" },
  { href: "/credits", label: "Credits", icon: "account_balance_wallet" },
  { href: "/settings", label: "Settings", icon: "tune" },
];

function initialsFromName(value?: string | null) {
  if (!value) return "V";
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "V";
}

export default function StudioSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { open, close } = useStudioSidebar();

  const displayName = user?.displayName || user?.email?.split("@")[0] || "Vibecraft User";
  const email = user?.email || "Signed in";

  return (
    <>
      <div
        aria-hidden="true"
        onClick={close}
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/8 bg-[#081121]/95 p-6 shadow-[20px_0_60px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link href="/" onClick={close} className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-1.5 shadow-[0_0_30px_rgba(59,130,246,0.18)]">
            <img
              src="/best-version/logo-192.png?v=20260506-1210"
              alt="Vibecraft logo"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight text-white">Vibecraft</div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Studio shell</div>
          </div>
        </Link>

        <nav className="mt-8 flex-1 space-y-2">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/8 text-white shadow-[0_0_20px_rgba(59,130,246,0.08)]"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/10 text-sm font-bold text-blue-200">
              {initialsFromName(displayName)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{displayName}</div>
              <div className="truncate text-xs text-slate-500">{email}</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
