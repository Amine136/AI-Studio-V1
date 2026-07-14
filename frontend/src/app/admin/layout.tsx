"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdminSession } from "./_components/useAdminSession";
import { api } from "../../services/api";
import AnimatedLogo from "../../components/AnimatedLogo";
import "./admin.css";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { session, loading, error } = useAdminSession();

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
        const navItems = [
            { name: "Dashboard", icon: "dashboard", path: "/admin" },
            { name: "Users", icon: "group", path: "/admin/users" },
            { name: "Codes", icon: "terminal", path: "/admin/codes" },
            { name: "News", icon: "newspaper", path: "/admin/news" },
            { name: "Models", icon: "view_in_ar", path: "/admin/models" },
            { name: "Finance", icon: "account_balance", path: "/admin/finance" },
            { name: "Logs", icon: "database", path: "/admin/logs" },
            { name: "Warnings", icon: "warning", path: "/admin/warnings" },
        ];

        content = (
            <div className="admin-wrapper h-screen flex bg-surface overflow-hidden">
                {/* Sidebar */}
                <aside className="fixed left-0 top-0 h-screen w-64 z-40 bg-surface-container-low border-r border-outline-variant flex flex-col">
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
                            const isActive = pathname === item.path || (item.path !== "/admin" && pathname?.startsWith(item.path));
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

                {/* Top Bar */}
                <header className="fixed top-0 right-0 left-64 h-16 z-30 bg-surface-dim border-b border-outline-variant flex items-center justify-end px-8 w-[calc(100%-16rem)]">
                    <div className="flex items-center gap-6">
                        <div className="flex gap-2">
                            <button className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-primary transition-all">
                                <span className="material-symbols-outlined">notifications</span>
                            </button>
                            <button className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:text-primary transition-all">
                                <span className="material-symbols-outlined">settings</span>
                            </button>
                        </div>
                        <button
                            onClick={async () => {
                                await api.adminLogout();
                                window.location.href = "/admin/login";
                            }}
                            className="px-6 py-1.5 border border-outline-variant rounded-lg font-label-caps text-[11px] text-on-surface-variant hover:border-primary hover:text-primary transition-all"
                        >
                            Sign Out
                        </button>
                    </div>
                </header>

                {/* Main Content Area */}
                <div className="ml-64 mt-16 flex flex-col flex-1 h-[calc(100vh-4rem)]">
                    {children}
                </div>
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
