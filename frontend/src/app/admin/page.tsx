"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "../../services/api";
import {
    AdminAuditLogItem,
    AdminCreditCodeItem,
    AdminUserListItem,
    CatalogWarningItem,
} from "../../types";

// Helper for shortened ID if needed
function shortId(uid: string) {
    if (!uid) return "";
    if (uid.length <= 8) return uid;
    return uid.substring(0, 8);
}

function formatCreditAmount(value: number): string {
    if (value > 0 && value < 0.01) {
        return value.toFixed(3);
    }
    return value.toFixed(2);
}

export default function AdminPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [users, setUsers] = useState<AdminUserListItem[]>([]);
    const [totalUsers, setTotalUsers] = useState(0);
    const [codes, setCodes] = useState<AdminCreditCodeItem[]>([]);
    const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
    const [warnings, setWarnings] = useState<CatalogWarningItem[]>([]);

    useEffect(() => {
        let cancelled = false;

        const loadDashboard = async () => {
            setLoading(true);
            setLoadError("");
            try {
                const [userResponse, codeResponse, logResponse, configResponse] = await Promise.all([
                    api.getAdminUsers({ limit: 200 }),
                    api.getAdminCodes(),
                    api.getAdminLogs({ limit: 4 }),
                    api.getConfig(),
                ]);

                if (cancelled) return;
                setUsers(userResponse.users ?? []);
                setTotalUsers(userResponse.total ?? 0);
                setCodes(codeResponse.codes ?? []);
                setLogs(logResponse.logs ?? []);
                setWarnings(configResponse.catalog_warnings ?? []);
            } catch (error) {
                if (cancelled) return;
                setLoadError(error instanceof Error ? error.message : "Unable to load admin overview.");
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadDashboard();

        return () => {
            cancelled = true;
        };
    }, []);

    const totalCredits = useMemo(
        () => users.reduce((sum, item) => sum + (item.totalCredits || item.credits || 0), 0),
        [users],
    );
    const activeCodes = useMemo(
        () => codes.filter((code) => code.status === "active").length,
        [codes],
    );
    const newRegistrationsToday = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return users.filter(u => u.createdAt && new Date(u.createdAt) >= today).length;
    }, [users]);
    const activeUsers = useMemo(
        () => users.filter((item) => !item.isSuspended).length,
        [users],
    );
    const fundedUsers = useMemo(
        () => users.filter((item) => (item.totalCredits || item.credits || 0) > 0).length,
        [users],
    );
    const userTrend = users.length ? `${Math.round((activeUsers / users.length) * 100)}% active` : "0% active";
    const creditTrend = users.length ? `${Math.round((fundedUsers / users.length) * 100)}% funded` : "0% funded";
    const codeTrend = codes.length ? `${Math.round((activeCodes / codes.length) * 100)}% redeemable` : "0% redeemable";
    const recentUsers = useMemo(() => users.slice(0, 6), [users]);

    // Helper for relative time
    const getRelativeTime = (timestamp: string | number | null | undefined) => {
        if (!timestamp) return "Recently";
        try {
            const date = new Date(timestamp);
            const now = new Date();
            const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
            if (diffInSeconds < 60) return "Just now";
            if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
            if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
            return `${Math.floor(diffInSeconds / 86400)} days ago`;
        } catch {
            return "Recently";
        }
    };

    return (
        <main className="flex-1 overflow-y-auto p-6 custom-scrollbar relative">
            <div className="max-w-[1440px] mx-auto space-y-6">
                {/* Summary Stats */}
                <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Total Users */}
                    <div className="glass-panel p-6 rounded-lg flex flex-col justify-between relative overflow-hidden group hover:border-primary/50 transition-all" style={{ boxShadow: "none" }}>
                        <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors"></div>
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="font-label-caps text-label-caps text-on-surface-variant">Total Users</p>
                                <h2 className="font-headline-lg text-headline-lg text-on-surface mt-1">{totalUsers}</h2>
                            </div>
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>group</span>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <span className="flex items-center text-tertiary font-label-caps text-[11px] bg-tertiary/10 px-2 py-0.5 rounded-full">
                                <span className="material-symbols-outlined text-sm mr-1">check_circle</span>
                                {userTrend}
                            </span>
                            <span className="text-on-surface-variant font-body-sm text-xs">active users</span>
                        </div>
                    </div>

                    {/* Total Credits */}
                    <div className="glass-panel p-6 rounded-lg flex flex-col justify-between relative overflow-hidden group hover:border-secondary/50 transition-all" style={{ boxShadow: "none" }}>
                        <div className="absolute -right-4 -top-4 w-24 h-24 bg-secondary/5 rounded-full blur-2xl group-hover:bg-secondary/10 transition-colors"></div>
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="font-label-caps text-label-caps text-on-surface-variant">Total Credits</p>
                                <h2 className="font-headline-lg text-headline-lg text-on-surface mt-1">{totalCredits.toFixed(2)}</h2>
                            </div>
                            <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary">
                                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>payments</span>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <span className="flex items-center text-tertiary font-label-caps text-[11px] bg-tertiary/10 px-2 py-0.5 rounded-full">
                                <span className="material-symbols-outlined text-sm mr-1">check_circle</span>
                                {creditTrend}
                            </span>
                            <span className="text-on-surface-variant font-body-sm text-xs">funded users</span>
                        </div>
                    </div>

                    {/* Active Codes */}
                    <div className="glass-panel p-6 rounded-lg flex flex-col justify-between relative overflow-hidden group hover:border-tertiary/50 transition-all" style={{ boxShadow: "none" }}>
                        <div className="absolute -right-4 -top-4 w-24 h-24 bg-tertiary/5 rounded-full blur-2xl group-hover:bg-tertiary/10 transition-colors"></div>
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="font-label-caps text-label-caps text-on-surface-variant">Active Codes</p>
                                <h2 className="font-headline-lg text-headline-lg text-on-surface mt-1">{activeCodes}</h2>
                            </div>
                            <div className="w-10 h-10 rounded-lg bg-tertiary/10 flex items-center justify-center text-tertiary">
                                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>qr_code</span>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <span className="flex items-center text-tertiary font-label-caps text-[11px] bg-tertiary/10 px-2 py-0.5 rounded-full">
                                <span className="material-symbols-outlined text-sm mr-1">check_circle</span>
                                {codeTrend}
                            </span>
                            <span className="text-on-surface-variant font-body-sm text-xs">redeemable codes</span>
                        </div>
                    </div>

                    {/* New Registrations */}
                    <div className="glass-panel p-6 rounded-lg flex flex-col justify-between relative overflow-hidden group hover:border-[#a78bfa]/50 transition-all" style={{ boxShadow: "none" }}>
                        <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#a78bfa]/5 rounded-full blur-2xl group-hover:bg-[#a78bfa]/10 transition-colors"></div>
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="font-label-caps text-label-caps text-on-surface-variant">New Users</p>
                                <h2 className="font-headline-lg text-headline-lg text-on-surface mt-1">+{newRegistrationsToday}</h2>
                            </div>
                            <div className="w-10 h-10 rounded-lg bg-[#a78bfa]/10 flex items-center justify-center text-[#a78bfa]">
                                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>person_add</span>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <span className="flex items-center text-[#a78bfa] font-label-caps text-[11px] bg-[#a78bfa]/10 px-2 py-0.5 rounded-full">
                                <span className="material-symbols-outlined text-sm mr-1">today</span>
                                Today
                            </span>
                            <span className="text-on-surface-variant font-body-sm text-xs">registrations</span>
                        </div>
                    </div>
                </section>

                {/* Main Bento Content */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Recent Users Table */}
                    <div className="lg:col-span-8 glass-panel rounded-lg flex flex-col overflow-hidden" style={{ boxShadow: "none" }}>
                        <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-center">
                            <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary">person_search</span>
                                Recent Users
                            </h3>
                            <button onClick={() => router.push("/admin/users")} className="text-primary font-label-caps text-[11px] hover:underline">View All</button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-surface-container-high/30">
                                        <th className="px-6 py-3 font-label-caps text-label-caps text-on-surface-variant uppercase text-[10px]">User</th>
                                        <th className="px-6 py-3 font-label-caps text-label-caps text-on-surface-variant uppercase text-[10px]">ID</th>
                                        <th className="px-6 py-3 font-label-caps text-label-caps text-on-surface-variant uppercase text-[10px]">Status</th>
                                        <th className="px-6 py-3 font-label-caps text-label-caps text-on-surface-variant uppercase text-[10px]">Balance</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-outline-variant/50">
                                    {recentUsers.map((item) => (
                                        <tr key={item.uid} className="hover:bg-surface-bright/50 transition-colors">
                                            <td className="px-6 py-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-bold text-xs uppercase">
                                                        {(item.displayName || item.email || "?").charAt(0)}
                                                    </div>
                                                    <span className="font-body-lg text-body-lg text-on-surface">{item.displayName || "Anonymous"}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-3 font-code-sm text-code-sm text-on-surface-variant">{shortId(item.uid)}</td>
                                            <td className="px-6 py-3">
                                                {item.isSuspended ? (
                                                    <span className="px-2 py-0.5 rounded-full bg-error/10 text-error font-label-caps text-[10px]">Suspended</span>
                                                ) : (
                                                    <span className="px-2 py-0.5 rounded-full bg-tertiary/10 text-tertiary font-label-caps text-[10px]">Active</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-3 font-code-sm text-code-sm text-secondary">
                                                {formatCreditAmount(item.totalCredits || item.credits || 0)} CR
                                            </td>
                                        </tr>
                                    ))}
                                    {recentUsers.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-8 text-center text-on-surface-variant text-sm">
                                                {loading ? "Loading users..." : (loadError || "No recent users.")}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Recent Logs Timeline */}
                    <div className="lg:col-span-4 glass-panel rounded-lg flex flex-col" style={{ boxShadow: "none" }}>
                        <div className="px-6 py-4 border-b border-outline-variant flex justify-between items-center">
                            <h3 className="font-title-md text-title-md text-on-surface flex items-center gap-2">
                                <span className="material-symbols-outlined text-secondary">history</span>
                                Recent Logs
                            </h3>
                            <button onClick={() => router.push("/admin/logs")} className="text-secondary font-label-caps text-[11px] hover:underline">View All</button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto max-h-[400px] custom-scrollbar">
                            {logs.map((log) => (
                                <div key={log.id} className="flex gap-4 relative">
                                    <div className="flex flex-col items-center">
                                        <div className="w-2 h-2 rounded-full bg-tertiary mt-1.5 glow-accent"></div>
                                        <div className="w-px h-full bg-outline-variant/30 mt-1"></div>
                                    </div>
                                    <div className="pb-4">
                                        <p className="font-body-sm text-body-sm text-on-surface font-medium leading-tight">{log.action}</p>
                                        <p className="text-[11px] text-on-surface-variant mt-0.5">{getRelativeTime(log.createdAt)} • {log.adminEmail}</p>
                                        <p className="text-[10px] text-outline mt-1 truncate max-w-[200px]">{log.reason}</p>
                                    </div>
                                </div>
                            ))}
                            {logs.length === 0 && (
                                <div className="text-center text-on-surface-variant text-sm py-4">
                                    {loading ? "Loading logs..." : "No recent logs."}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Warnings Section */}
                    {warnings.map((warning) => (
                        <div key={`${warning.task}-${warning.model}`} className="lg:col-span-12 glass-panel rounded-lg p-6 border-l-4 border-error/80 bg-error-container/5 relative overflow-hidden group hover:border-error transition-colors" style={{ boxShadow: "none" }}>
                            <div className="absolute right-0 top-0 w-32 h-32 bg-error/5 rounded-full blur-3xl group-hover:bg-error/10 transition-colors pointer-events-none"></div>
                            <div className="flex items-start gap-4 relative z-10">
                                <div className="w-12 h-12 rounded-lg bg-error/10 flex items-center justify-center text-error flex-shrink-0 shadow-inner">
                                    <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <h3 className="font-title-md text-[18px] text-error font-bold flex items-center gap-2">
                                            Pricing Alert: {warning.task.charAt(0).toUpperCase() + warning.task.slice(1)} Configuration
                                        </h3>
                                    </div>
                                    <p className="font-body-md text-on-surface opacity-90 mt-1">{warning.message}</p>
                                    
                                    <div className="mt-4 flex flex-wrap gap-2 text-[12px] font-code-sm font-medium">
                                        <span className="rounded-lg border border-error/20 bg-error/10 text-error px-3 py-1.5 flex items-center gap-1.5">
                                            <span className="material-symbols-outlined text-[14px]">tune</span>
                                            Configured: {formatCreditAmount(warning.configured_cost)}
                                        </span>
                                        <span className="rounded-lg border border-tertiary/20 bg-tertiary/10 text-tertiary px-3 py-1.5 flex items-center gap-1.5">
                                            <span className="material-symbols-outlined text-[14px]">gavel</span>
                                            Minimum: {formatCreditAmount(warning.minimum_cost)}
                                        </span>
                                        <span className="rounded-lg border border-outline-variant bg-surface-container-highest text-on-surface-variant px-3 py-1.5 flex items-center gap-1.5">
                                            <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                                            Model: {warning.model}
                                        </span>
                                    </div>
                                    
                                    <div className="mt-5 flex gap-3">
                                        <button onClick={() => router.push("/admin/warnings")} className="bg-error hover:bg-error/90 text-white shadow-lg shadow-error/20 px-5 py-2 rounded-lg font-label-caps text-[12px] font-bold transition-all flex items-center gap-2 active:scale-[0.98]">
                                            <span className="material-symbols-outlined text-[16px]">manage_search</span>
                                            Resolve Issue
                                        </button>
                                        <button onClick={() => router.push("/admin/warnings")} className="bg-surface-container-highest hover:bg-surface-bright text-on-surface border border-outline-variant px-5 py-2 rounded-lg font-label-caps text-[12px] font-bold transition-all flex items-center gap-2 active:scale-[0.98]">
                                            View Logs
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
