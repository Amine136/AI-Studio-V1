"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdminSession } from "./_components/useAdminSession";
import { api } from "../../services/api";
import AnimatedLogo from "../../components/AnimatedLogo";
import "./admin.css";

type AdminNavItem = { name: string; icon: string; path: string; shortName?: string };

// Primary destinations — the desktop rail lists all of them; below lg these four
// plus "More" are the bottom tab bar. Four cells is the ceiling at 360px once the
// More cell is counted.
const primaryNav: AdminNavItem[] = [
    { name: "Dashboard", icon: "dashboard", path: "/admin", shortName: "Home" },
    { name: "Users", icon: "group", path: "/admin/users" },
    { name: "Codes", icon: "terminal", path: "/admin/codes" },
    { name: "Orders", icon: "receipt_long", path: "/admin/orders" },
];

// Secondary destinations — same rail on desktop, the "More" sheet on mobile.
const secondaryNav: AdminNavItem[] = [
    { name: "Feedback", icon: "rate_review", path: "/admin/feedback" },
    { name: "Models", icon: "view_in_ar", path: "/admin/models" },
    { name: "Finance", icon: "account_balance", path: "/admin/finance" },
    { name: "Logs", icon: "database", path: "/admin/logs" },
    { name: "Warnings", icon: "warning", path: "/admin/warnings" },
];

function isActivePath(item: AdminNavItem, pathname: string | null) {
    if (!pathname) return false;
    return pathname === item.path || (item.path !== "/admin" && pathname.startsWith(item.path));
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { session, loading, error } = useAdminSession();
    const [moreOpen, setMoreOpen] = useState(false);

    // Deter casual inspection of the admin panel: block the common devtools /
    // view-source keyboard shortcuts. Only fires while an admin route is
    // mounted (listener cleaned up on unmount). Not a security control -- it
    // cannot stop a determined user -- just a deterrent.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            const blocked =
                e.key === "F12" ||
                ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c")) ||
                ((e.ctrlKey || e.metaKey) && k === "u");
            if (blocked) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, []);

    // The admin panel keeps the Nebula dark theme regardless of the user-app
    // light/dark preference; the choice is restored when leaving admin.
    useEffect(() => {
        const root = document.documentElement;
        const previous = root.getAttribute("data-theme");
        root.removeAttribute("data-theme");
        return () => {
            if (previous) root.setAttribute("data-theme", previous);
        };
    }, []);

    // The "More" sheet is a modal surface: Escape dismisses it, the page behind it
    // must not scroll underneath, and it closes on navigation so it never outlives
    // the route it was opened from. Same contract as the user app's sheet.
    useEffect(() => {
        if (!moreOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMoreOpen(false);
        };
        document.addEventListener("keydown", onKey);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = previousOverflow;
        };
    }, [moreOpen]);

    useEffect(() => {
        setMoreOpen(false);
    }, [pathname]);

    const signOut = async () => {
        await api.adminLogout();
        window.location.href = "/admin/login";
    };

    let content: React.ReactNode;

    if (pathname === "/admin/login") {
        content = children;
    } else if (loading || !session) {
        if (!loading && error) {
            content = (
                <main className="min-h-screen flex items-center justify-center px-4 admin-wrapper bg-surface">
                    <div className="glass-panel p-8 rounded-lg max-w-[448px] w-full text-center">
                        <h1 className="text-2xl font-headline-lg font-extrabold text-primary">Admin Access</h1>
                        <p className="text-sm font-body-sm text-on-surface-variant mt-3">
                            Unable to verify admin access right now.
                        </p>
                        <p className="mt-2 text-sm font-body-sm text-error">{error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="bg-primary text-on-primary font-bold py-2 px-4 rounded mt-6 w-full"
                        >
                            <span>Retry</span>
                        </button>
                    </div>
                </main>
            );
        } else {
            content = (
                <main className="min-h-screen flex items-center justify-center admin-wrapper bg-surface">
                    <div className="auth-loader" />
                </main>
            );
        }
    } else {
        const navItems = [...primaryNav, ...secondaryNav];

        content = (
            /* Below lg the shell scrolls as one document, so the height is left to the
               content; from lg it becomes the fixed-height two-pane app. 100dvh, not
               100vh -- the latter is the mobile-browser bar bug from the playground. */
            <div className="admin-wrapper min-h-[100dvh] lg:h-screen flex bg-surface lg:overflow-hidden">
                {/* Sidebar — desktop only; below lg navigation is the bottom tab bar. */}
                <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-64 z-40 bg-surface-container-low border-r border-outline-variant flex-col">
                    <div className="p-6 mb-6">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 flex items-center justify-center overflow-visible">
                                <AnimatedLogo sizeClassName="w-10 h-10" imageClassName="w-8 h-8" />
                            </div>
                            <div>
                                <h1 className="font-title-md text-title-md font-bold text-primary leading-none">Vibecraft Admin</h1>
                                <p className="font-label-caps text-[10px] text-on-surface-variant leading-none mt-1">System Control</p>
                            </div>
                        </div>
                    </div>

                    <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar">
                        {navItems.map((item) => {
                            const isActive = isActivePath(item, pathname);
                            if (isActive) {
                                return (
                                    <a key={item.name} onClick={() => router.push(item.path)} className="flex items-center gap-6 px-6 py-4 bg-primary-container text-on-primary-container rounded-lg shadow-sm cursor-pointer">
                                        <span className="material-symbols-outlined">{item.icon}</span>
                                        <span className="font-label-caps text-label-caps font-bold">{item.name}</span>
                                    </a>
                                );
                            }
                            return (
                                <a key={item.name} onClick={() => router.push(item.path)} className="flex items-center gap-6 px-6 py-4 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest rounded-lg transition-colors cursor-pointer">
                                    <span className="material-symbols-outlined">{item.icon}</span>
                                    <span className="font-label-caps text-label-caps">{item.name}</span>
                                </a>
                            );
                        })}
                    </nav>

                    <div className="mt-auto p-6 border-t border-outline-variant bg-surface-container-low/50">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full border border-outline-variant flex items-center justify-center bg-surface-bright text-on-surface-variant">
                                 <span className="material-symbols-outlined">person</span>
                            </div>
                            <div className="overflow-hidden">
                                <p className="font-label-caps text-label-caps text-on-surface truncate">
                                    {session?.username ? session.username.substring(0, 4) + '***' : 'Root***'}
                                </p>
                                <p className="text-[10px] text-on-surface-variant">System Verified</p>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Top Bar — full width on phones (no rail to sit beside), and it carries
                    the wordmark there since the sidebar that normally shows it is hidden. */}
                <header className="fixed top-0 right-0 left-0 lg:left-64 h-16 z-30 bg-surface-dim border-b border-outline-variant flex items-center justify-between lg:justify-end gap-3 px-4 lg:px-8 w-full lg:w-[calc(100%-16rem)]">
                    <div className="flex items-center gap-2 min-w-0 lg:hidden">
                        <div className="w-8 h-8 flex items-center justify-center overflow-visible shrink-0">
                            <AnimatedLogo sizeClassName="w-10 h-10" imageClassName="w-8 h-8" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="font-title-md text-title-md font-bold text-primary leading-none truncate">Vibecraft Admin</h1>
                            <p className="font-label-caps text-[10px] text-on-surface-variant leading-none mt-1 truncate">
                                {session?.username ? session.username.substring(0, 4) + '***' : 'Root***'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 lg:gap-6 shrink-0">
                        {/* Decorative on desktop and not yet wired to anything -- kept off the
                            phone bar rather than spending its width on dead controls. */}
                        <div className="hidden lg:flex gap-2">
                            <button className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-primary transition-all">
                                <span className="material-symbols-outlined">notifications</span>
                            </button>
                            <button className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-primary transition-all">
                                <span className="material-symbols-outlined">settings</span>
                            </button>
                        </div>
                        <button
                            onClick={signOut}
                            className="px-3 lg:px-6 py-1.5 border border-outline-variant rounded-lg font-label-caps text-[11px] text-on-surface-variant hover:border-primary hover:text-primary transition-all whitespace-nowrap"
                        >
                            Sign Out
                        </button>
                    </div>
                </header>

                {/* Main Content Area. admin-nav-clear reserves the tab bar's height (plus
                    the gesture-bar inset) so the last row of every page stays reachable. */}
                <div className="mt-16 flex flex-col flex-1 min-w-0 admin-nav-clear lg:ml-64 lg:h-[calc(100vh-4rem)]">
                    {children}
                </div>

                {/* Mobile tab bar */}
                <nav className="admin-bottom-nav" aria-label="Admin sections">
                    {primaryNav.map((item) => {
                        const isActive = isActivePath(item, pathname);
                        return (
                            <button
                                key={item.name}
                                type="button"
                                onClick={() => router.push(item.path)}
                                aria-current={isActive ? "page" : undefined}
                                className={`admin-bottom-nav__item ${isActive ? "admin-bottom-nav__item--active" : ""}`}
                            >
                                <span
                                    className="material-symbols-outlined text-[22px]"
                                    style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                >
                                    {item.icon}
                                </span>
                                <span className="admin-bottom-nav__label">{item.shortName || item.name}</span>
                            </button>
                        );
                    })}

                    <button
                        type="button"
                        onClick={() => setMoreOpen(true)}
                        aria-haspopup="dialog"
                        aria-expanded={moreOpen}
                        className={`admin-bottom-nav__item ${
                            moreOpen || secondaryNav.some((item) => isActivePath(item, pathname))
                                ? "admin-bottom-nav__item--active"
                                : ""
                        }`}
                    >
                        <span className="material-symbols-outlined text-[22px]">more_horiz</span>
                        <span className="admin-bottom-nav__label">More</span>
                    </button>
                </nav>

                {moreOpen ? (
                    <div className="admin-sheet-layer" role="dialog" aria-modal="true" aria-label="More admin sections">
                        <button type="button" aria-label="Close" onClick={() => setMoreOpen(false)} className="admin-sheet__scrim" />
                        <div className="admin-sheet">
                            <div className="admin-sheet__grab" aria-hidden="true" />
                            <div className="space-y-1">
                                {secondaryNav.map((item) => {
                                    const isActive = isActivePath(item, pathname);
                                    return (
                                        <button
                                            key={item.name}
                                            type="button"
                                            onClick={() => router.push(item.path)}
                                            aria-current={isActive ? "page" : undefined}
                                            className={`admin-sheet__row ${isActive ? "admin-sheet__row--active" : ""}`}
                                        >
                                            <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                                            <span>{item.name}</span>
                                        </button>
                                    );
                                })}
                                <button type="button" onClick={signOut} className="admin-sheet__row">
                                    <span className="material-symbols-outlined text-[20px]">logout</span>
                                    <span>Sign Out</span>
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }

    // The admin panel is always English / left-to-right, independent of the
    // app's default language (Arabic flips the whole site RTL via
    // LanguageProvider). Forcing dir/lang on this wrapper overrides the
    // inherited RTL direction for the entire admin subtree.
    return (
        <div dir="ltr" lang="en" className="admin-root" onContextMenu={(e) => e.preventDefault()}>
            {content}
        </div>
    );
}
