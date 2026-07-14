"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { signOutUser } from "../../lib/auth";
import { useStudioSidebar } from "./SidebarContext";
import ThemeToggle from "../ThemeToggle";

function nameFromUser(user: { displayName?: string | null; email?: string | null } | null | undefined) {
  return user?.displayName || user?.email?.split("@")[0] || "Creator";
}

export default function StudioTopNav() {
  const router = useRouter();
  const { user } = useAuth();
  const { toggle } = useStudioSidebar();
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
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-white/8 bg-[#08111f]/80 px-4 backdrop-blur-xl light:border-slate-900/10 light:bg-white/80 sm:px-6 lg:px-10">
      <div className="flex min-w-0 items-center gap-3 sm:gap-5">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={toggle}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white light:border-slate-900/10 light:bg-slate-900/[0.03] light:text-slate-600 light:hover:bg-slate-900/[0.06] light:hover:text-slate-900 lg:hidden"
        >
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>

        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Main app shell</div>
          <div className="truncate text-lg font-semibold tracking-tight text-white light:text-slate-900">
            Welcome back, {nameFromUser(user)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <ThemeToggle />
        <Link
          href="/"
          className="hidden rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white light:border-slate-900/10 light:bg-slate-900/[0.03] light:text-slate-600 light:hover:bg-slate-900/[0.06] light:hover:text-slate-900 sm:inline-flex"
        >
          Home
        </Link>
        <Link
          href="/dashboard"
          className="hidden rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white light:border-slate-900/10 light:bg-slate-900/[0.03] light:text-slate-600 light:hover:bg-slate-900/[0.06] light:hover:text-slate-900 md:inline-flex"
        >
          Dashboard
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-full border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 transition-colors hover:bg-rose-500/15 light:text-rose-600"
        >
          {signingOut ? "Signing out…" : "Sign Out"}
        </button>
      </div>
    </header>
  );
}
