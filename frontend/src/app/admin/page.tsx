"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import AnimatedLogo from "../../components/AnimatedLogo";
import { api } from "../../services/api";
import { useAdminSession } from "./_components/useAdminSession";
import {
    AdminAuditLogItem,
    AdminCreditCodeItem,
    AdminUserListItem,
    CatalogWarningItem,
} from "../../types";

function formatCreditAmount(value: number): string {
    if (value > 0 && value < 0.01) {
        return value.toFixed(3);
    }
    return value.toFixed(2);
}

export default function AdminPage() {
    const router = useRouter();
    const { session, loading: sessionLoading, error: sessionError } = useAdminSession();
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [users, setUsers] = useState<AdminUserListItem[]>([]);
    const [codes, setCodes] = useState<AdminCreditCodeItem[]>([]);
    const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
    const [warnings, setWarnings] = useState<CatalogWarningItem[]>([]);

    useEffect(() => {
        if (!session) return;
        let cancelled = false;

        const loadDashboard = async () => {
            setLoading(true);
            setLoadError("");
            try {
                const [userResponse, codeResponse, logResponse, configResponse] = await Promise.all([
                    api.getAdminUsers({ limit: 6 }),
                    api.getAdminCodes(),
                    api.getAdminLogs({ limit: 4 }),
                    api.getConfig(),
                ]);

                if (cancelled) return;
                setUsers(userResponse.users ?? []);
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
    }, [session]);

    const totalCredits = useMemo(
        () => users.reduce((sum, item) => sum + (item.totalCredits || item.credits || 0), 0),
        [users],
    );
    const activeCodes = useMemo(
        () => codes.filter((code) => code.status === "active").length,
        [codes],
    );
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

    if (sessionLoading || !session) {
        if (!sessionLoading && sessionError) {
            return (
                <main className="min-h-screen flex items-center justify-center px-4">
                    <div className="glass-card p-8 max-w-md w-full text-center">
                        <h1 className="text-2xl font-extrabold gradient-text">Admin Access</h1>
                        <p className="text-sm text-gray-400 mt-3">
                            Unable to verify admin access right now.
                        </p>
                        <p className="mt-2 text-sm text-amber-300">{sessionError}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="btn-primary mt-6 w-full"
                        >
                            <span>Retry</span>
                        </button>
                    </div>
                </main>
            );
        }
        return (
            <main className="min-h-screen flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    return (
        <main className="min-h-screen flex items-start justify-center px-3 py-8 sm:px-4 sm:py-16">
            <div className="w-full max-w-6xl">
                <div className="admin-header animate-fade-in">
                    <div className="flex items-center gap-4 min-w-0">
                        <AnimatedLogo sizeClassName="h-20 w-20 flex-shrink-0" imageClassName="h-16 w-16" />
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-extrabold gradient-text tracking-tight">
                                Admin Panel
                            </h1>
                            <p className="text-xs text-gray-500 mt-0.5">
                                Minimal overview for users, codes, jobs, and audit activity
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={async () => {
                                await api.adminLogout();
                                window.location.href = "/login";
                            }}
                            className="btn-secondary px-4 py-2 text-sm"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 xl:grid-cols-3 animate-fade-in-up" style={{ animationDelay: "80ms" }}>
                    <StatCard
                        label="Total Users"
                        value={String(users.length)}
                        trend={userTrend}
                        accent="blue"
                        icon={
                            <>
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </>
                        }
                    />
                    <StatCard
                        label="Total Credits"
                        value={parseFloat(totalCredits.toFixed(2)).toString()}
                        trend={creditTrend}
                        accent="green"
                        icon={
                            <>
                                <circle cx="12" cy="12" r="10" />
                                <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                                <path d="M12 18V6" />
                            </>
                        }
                    />
                    <StatCard
                        label="Active Codes"
                        value={String(activeCodes)}
                        trend={codeTrend}
                        accent="purple"
                        icon={
                            <>
                                <rect x="2" y="5" width="20" height="14" rx="2" />
                                <line x1="2" y1="10" x2="22" y2="10" />
                            </>
                        }
                    />
                </div>

                <div className="glass-card p-4 sm:p-5 mb-6 animate-fade-in" style={{ animationDelay: "140ms" }}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">Quick Access</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <QuickAccessButton label="Users" onClick={() => router.push("/users")} icon="users" />
                            <QuickAccessButton label="Codes" onClick={() => router.push("/codes")} icon="codes" />
                            <QuickAccessButton label="News" onClick={() => router.push("/news")} icon="news" />
                            <QuickAccessButton label="Logs" onClick={() => router.push("/logs")} icon="logs" />
                            <QuickAccessButton label="Warnings" onClick={() => router.push("/warnings")} icon="warnings" />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <OverviewTable
                        title="Recent Users"
                        subtitle="Latest accounts and balance state"
                        meta={`${users.length} loaded`}
                        action={
                            <button onClick={() => router.push("/users")} className="admin-gradient-btn">
                                More details
                            </button>
                        }
                        hasItems={users.length > 0}
                        loading={loading}
                        emptyText={loadError || "No users available"}
                    >
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Credits</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((item) => (
                                    <tr key={item.uid} className="admin-dashboard-row">
                                        <td>
                                            <div className="admin-user-cell">
                                                <div className="admin-avatar">
                                                    {(item.displayName || item.email || "?").charAt(0).toUpperCase()}
                                                </div>
                                                <div className="admin-user-info">
                                                    <span className="admin-user-name">{item.displayName || "Anonymous"}</span>
                                                    <span className="admin-user-uid">{item.email || shortId(item.uid)}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <CreditLevel value={item.totalCredits} />
                                        </td>
                                        <td>
                                            <span className="text-sm text-slate-300">
                                                {item.isSuspended ? "Suspended" : "Active"}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </OverviewTable>

                    <OverviewPanel
                        title="Recent Logs"
                        subtitle="Audit trail for admin actions"
                        meta={`${logs.length} entries`}
                        action={
                            <button onClick={() => router.push("/logs")} className="admin-gradient-btn">
                                More details
                            </button>
                        }
                        hasItems={logs.length > 0}
                        loading={loading}
                        emptyText={loadError || "No recent admin actions"}
                    >
                        {logs.map((log) => (
                            <div key={log.id} className="mx-5 my-4 rounded-2xl border border-white/6 bg-white/[0.02] p-4 transition-all duration-150 ease-in-out hover:bg-white/[0.03]">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-slate-100">{log.adminEmail}</p>
                                        <div className="mt-2">
                                            <span className={getActionChipClassName(log.action)}>{humanizeAction(log.action)}</span>
                                        </div>
                                    </div>
                                    <span className="shrink-0 text-xs text-slate-500">{formatTimestamp(log.createdAt)}</span>
                                </div>
                                <div className="mt-4 border-t border-white/6 pt-3">
                                    <p className="text-sm text-slate-300">{log.reason}</p>
                                </div>
                            </div>
                        ))}
                    </OverviewPanel>
                </div>

                <div className="grid grid-cols-1 gap-6 mt-6">
                    <OverviewPanel
                        title="Warnings"
                        subtitle="Model minimum pricing below enforced backend floors"
                        meta={`${warnings.length} active`}
                        action={
                            <button onClick={() => router.push("/warnings")} className="admin-gradient-btn">
                                More details
                            </button>
                        }
                        hasItems={warnings.length > 0}
                        loading={loading}
                        emptyText={loadError || "No catalog warnings detected"}
                    >
                        <div id="catalog-warnings" className="space-y-3 px-5 py-5">
                            {warnings.map((warning) => (
                                <div key={`${warning.task}-${warning.model}`} className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                                            {warning.task}
                                        </span>
                                        <span className="text-sm font-semibold text-white">{warning.display_name}</span>
                                    </div>
                                    <p className="mt-2 text-sm text-slate-200">{warning.message}</p>
                                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                                        <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
                                            Configured: {formatCreditAmount(warning.configured_cost)}
                                        </span>
                                        <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
                                            Minimum: {formatCreditAmount(warning.minimum_cost)}
                                        </span>
                                        <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
                                            Model: {warning.model}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </OverviewPanel>
                </div>

                <div className="grid grid-cols-1 gap-6 mt-6">
                    <OverviewTable
                        title="Credit Codes"
                        subtitle="Current code availability"
                        meta={`${codes.length} total`}
                        hasItems={codes.length > 0}
                        loading={loading}
                        emptyText={loadError || "No credit codes found"}
                    >
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Code</th>
                                    <th>Credits</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {codes.slice(0, 6).map((code) => (
                                    <tr key={code.code}>
                                        <td>
                                            <div className="admin-user-info">
                                                <span className="admin-user-name">{code.codePreview}</span>
                                                <span className="admin-user-uid">
                                                    {code.claimedCount} / {code.maxClaims} claims
                                                </span>
                                            </div>
                                        </td>
                                        <td>
                                            <span className="admin-credits-badge admin-credits-positive">{code.credits.toFixed(2)}</span>
                                        </td>
                                        <td>
                                            <span className="text-sm text-slate-300">{code.status}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </OverviewTable>
                </div>
            </div>
        </main>
    );
}

function StatCard({
    label,
    value,
    trend,
    accent,
    icon,
}: {
    label: string;
    value: string;
    trend: string;
    accent: "blue" | "green" | "purple";
    icon: ReactNode;
}) {
    const theme = {
        blue: {
            border: "border-l-sky-400",
            bg: "bg-[linear-gradient(180deg,rgba(59,130,246,0.14),rgba(255,255,255,0.02))]",
            icon: "border-sky-400/20 bg-sky-400/12 text-sky-300",
        },
        green: {
            border: "border-l-emerald-400",
            bg: "bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(255,255,255,0.02))]",
            icon: "border-emerald-400/20 bg-emerald-400/12 text-emerald-300",
        },
        purple: {
            border: "border-l-violet-400",
            bg: "bg-[linear-gradient(180deg,rgba(139,92,246,0.14),rgba(255,255,255,0.02))]",
            icon: "border-violet-400/20 bg-violet-400/12 text-violet-300",
        },
    }[accent];

    return (
        <div className={`admin-stat-card border-l-[3px] ${theme.border} ${theme.bg}`}>
            <div className={`admin-stat-icon border ${theme.icon}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {icon}
                </svg>
            </div>
            <div>
                <p className="admin-stat-label">{label}</p>
                <p className="admin-stat-value">{value}</p>
                <div className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-400">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300">
                        <path d="m18 15-6-6-6 6" />
                    </svg>
                    <span>{trend}</span>
                </div>
            </div>
        </div>
    );
}

function QuickAccessButton({
    label,
    onClick,
    icon,
}: {
    label: string;
    onClick: () => void;
    icon: "users" | "codes" | "news" | "logs" | "warnings";
}) {
    return (
        <button
            onClick={onClick}
            className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-white/[0.02] px-4 py-2 text-sm font-medium text-slate-200 transition-all duration-150 ease-in-out hover:bg-[linear-gradient(135deg,rgba(124,58,237,0.16),rgba(59,130,246,0.16))] hover:text-white"
        >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/6 text-violet-200">
                {icon === "users" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                ) : icon === "codes" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="M7 10h10" />
                        <path d="M7 14h6" />
                    </svg>
                ) : icon === "news" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 5h16v14H4z" />
                        <path d="M8 9h8" />
                        <path d="M8 13h8" />
                        <path d="M8 17h5" />
                    </svg>
                ) : icon === "warnings" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                )}
            </span>
            <span>{label}</span>
        </button>
    );
}

function CreditLevel({ value }: { value: number }) {
    const normalized = Math.max(0, Math.min(100, Math.round((value / 10) * 100)));
    return (
        <div className="min-w-[132px]">
            <div className="h-2 overflow-hidden rounded-full bg-white/6">
                <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#22c55e,#3b82f6)] transition-all duration-150 ease-in-out"
                    style={{ width: `${normalized}%` }}
                />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[11px] uppercase tracking-wide text-slate-500">Credits</span>
                <span className="text-sm font-semibold text-slate-100">{value.toFixed(2)}</span>
            </div>
        </div>
    );
}

function OverviewTable({
    title,
    subtitle,
    meta,
    action,
    hasItems,
    loading,
    emptyText,
    children,
}: {
    title: string;
    subtitle: string;
    meta: string;
    action?: ReactNode;
    hasItems: boolean;
    loading: boolean;
    emptyText: string;
    children: ReactNode;
}) {
    return (
        <section className="glass-card relative overflow-hidden animate-fade-in-up">
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,rgba(124,58,237,0.8),rgba(59,130,246,0.8))]" />
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                <div>
                    <h2 className="text-base font-semibold text-white">{title}</h2>
                    <p className="text-xs text-slate-500">{subtitle}</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{meta}</span>
                    {action}
                </div>
            </div>
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="auth-loader" />
                </div>
            ) : !hasItems ? (
                <div className="admin-empty-state">
                    <p>{emptyText}</p>
                </div>
            ) : (
                <div className="overflow-x-auto">{children}</div>
            )}
        </section>
    );
}

function OverviewPanel({
    title,
    subtitle,
    meta,
    action,
    hasItems,
    loading,
    emptyText,
    children,
}: {
    title: string;
    subtitle: string;
    meta: string;
    action?: ReactNode;
    hasItems: boolean;
    loading: boolean;
    emptyText: string;
    children: ReactNode;
}) {
    return (
        <section className="glass-card relative overflow-hidden animate-fade-in-up">
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,rgba(124,58,237,0.8),rgba(59,130,246,0.8))]" />
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                <div>
                    <h2 className="text-base font-semibold text-white">{title}</h2>
                    <p className="text-xs text-slate-500">{subtitle}</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{meta}</span>
                    {action}
                </div>
            </div>
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="auth-loader" />
                </div>
            ) : !hasItems ? (
                <div className="admin-empty-state">
                    <p>{emptyText}</p>
                </div>
            ) : (
                <div>{children}</div>
            )}
        </section>
    );
}

function shortId(value: string): string {
    if (!value) return "unknown";
    return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

function humanizeAction(action: string): string {
    return action
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function formatTimestamp(timestamp?: number | null): string {
    if (!timestamp) return "unknown";
    return new Date(timestamp * 1000).toLocaleString();
}

function getActionChipClassName(action: string): string {
    const normalized = action.toLowerCase();
    if (normalized.includes("disable") || normalized.includes("suspend")) {
        return "inline-flex rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200";
    }
    if (normalized.includes("create") || normalized.includes("enable")) {
        return "inline-flex rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-1 text-[11px] font-semibold text-sky-200";
    }
    return "inline-flex rounded-full border border-violet-400/25 bg-violet-400/10 px-2.5 py-1 text-[11px] font-semibold text-violet-200";
}
