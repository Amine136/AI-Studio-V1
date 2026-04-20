"use client";

import { useEffect, useMemo, useState } from "react";

import AdminSubpage from "../_components/AdminSubpage";
import { api } from "../../../services/api";
import type { AdminAuditLogItem, AdminAuthFailureSummaryItem, CatalogWarningItem } from "../../../types";

const AUTH_WARNING_ACTIONS = new Set([
    "admin_login_lockout",
    "admin_login_success",
    "admin_login_admin_deactivated",
]);

export default function AdminWarningsPage() {
    const [catalogWarnings, setCatalogWarnings] = useState<CatalogWarningItem[]>([]);
    const [authWarnings, setAuthWarnings] = useState<AdminAuditLogItem[]>([]);
    const [authFailureSummaries, setAuthFailureSummaries] = useState<AdminAuthFailureSummaryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;

        const loadWarnings = async () => {
            setLoading(true);
            setError("");
            try {
                const [configResponse, logsResponse, authFailureResponse] = await Promise.all([
                    api.getConfig(),
                    api.getAdminLogs({ limit: 100 }),
                    api.getAdminAuthFailureSummaries(),
                ]);

                if (cancelled) return;
                setCatalogWarnings(configResponse.catalog_warnings ?? []);
                setAuthWarnings((logsResponse.logs ?? []).filter((log) => AUTH_WARNING_ACTIONS.has(log.action)));
                setAuthFailureSummaries(
                    (authFailureResponse.summaries ?? []).filter(
                        (summary) => summary.wrongPasswordFailures > 0 || summary.isLockedOut || !summary.isActive,
                    ),
                );
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Unable to load warnings.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadWarnings();

        return () => {
            cancelled = true;
        };
    }, []);

    const totalWarnings = useMemo(
        () => catalogWarnings.length + authWarnings.length + authFailureSummaries.length,
        [catalogWarnings.length, authWarnings.length, authFailureSummaries.length],
    );

    return (
        <AdminSubpage title="Admin Warnings" description="Operational warnings and security signals that need attention.">
            <div className="grid grid-cols-1 gap-6">
                <section className="glass-card overflow-hidden animate-fade-in-up">
                    <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                        <div>
                            <h2 className="text-base font-semibold text-white">Warnings Overview</h2>
                            <p className="text-xs text-slate-500">Catalog pricing issues and admin auth security events</p>
                        </div>
                        <span className="text-xs text-slate-500">{totalWarnings} items</span>
                    </div>
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="auth-loader" />
                        </div>
                    ) : error ? (
                        <div className="admin-empty-state">
                            <p>{error}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-6 p-5 xl:grid-cols-2">
                            <div className="rounded-3xl border border-white/8 bg-white/[0.02] p-5">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-white">Admin Auth Events</h3>
                                        <p className="mt-1 text-xs text-slate-500">Successful sign-ins, lockouts, and critical deactivations</p>
                                    </div>
                                    <span className="rounded-full border border-sky-300/15 bg-sky-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200">
                                        {authWarnings.length} events
                                    </span>
                                </div>
                                <div className="mt-4 space-y-3">
                                    {authWarnings.length === 0 ? (
                                        <p className="text-sm text-slate-400">No admin auth events recorded.</p>
                                    ) : (
                                        authWarnings.map((log) => (
                                            <div key={log.id} className="rounded-2xl border border-white/6 bg-white/[0.02] p-4">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className={getAuthWarningChipClassName(log.action)}>{humanizeAction(log.action)}</span>
                                                            <span className="text-xs text-slate-400">{log.targetId}</span>
                                                        </div>
                                                        <p className="mt-2 text-sm text-slate-200">{log.reason}</p>
                                                    </div>
                                                    <span className="shrink-0 text-xs text-slate-500">{formatTimestamp(log.createdAt)}</span>
                                                </div>
                                                {log.metadata && Object.keys(log.metadata).length > 0 ? (
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        {Object.entries(log.metadata).map(([key, value]) => (
                                                            <span
                                                                key={`${log.id}-${key}`}
                                                                className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400"
                                                            >
                                                                {key}: {formatMetadataValue(value)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="rounded-3xl border border-white/8 bg-white/[0.02] p-5">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-white">Admin Wrong Password Counts</h3>
                                        <p className="mt-1 text-xs text-slate-500">Aggregated failed-password counts for real admin usernames</p>
                                    </div>
                                    <span className="rounded-full border border-amber-300/15 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                                        {authFailureSummaries.length} active
                                    </span>
                                </div>
                                <div className="mt-4 space-y-3">
                                    {authFailureSummaries.length === 0 ? (
                                        <p className="text-sm text-slate-400">No active wrong-password counters for admin usernames.</p>
                                    ) : (
                                        authFailureSummaries.map((summary) => (
                                            <div key={summary.username} className="rounded-2xl border border-white/6 bg-white/[0.02] p-4">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className={getFailureSummaryChipClassName(summary)}>
                                                                {summary.isActive ? "Tracked" : "Deactivated"}
                                                            </span>
                                                            {summary.isLockedOut ? (
                                                                <span className="rounded-full border border-rose-300/20 bg-rose-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200">
                                                                    Locked Out
                                                                </span>
                                                            ) : null}
                                                            <span className="text-xs text-slate-400">{summary.username}</span>
                                                        </div>
                                                        <p className="mt-2 text-sm text-slate-200">
                                                            Wrong password attempts for this admin username are being aggregated instead of logged one by one.
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">
                                                        wrong_password_failures: {summary.wrongPasswordFailures}
                                                    </span>
                                                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">
                                                        lockout_threshold: {summary.lockoutThreshold}
                                                    </span>
                                                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">
                                                        deactivation_threshold: {summary.deactivationThreshold}
                                                    </span>
                                                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">
                                                        window: {formatWindow(summary.windowSeconds)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="rounded-3xl border border-white/8 bg-white/[0.02] p-5 xl:col-span-2">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-white">Catalog Warnings</h3>
                                        <p className="mt-1 text-xs text-slate-500">Model pricing below enforced backend floors</p>
                                    </div>
                                    <span className="rounded-full border border-amber-300/15 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                                        {catalogWarnings.length} active
                                    </span>
                                </div>
                                <div className="mt-4 space-y-3">
                                    {catalogWarnings.length === 0 ? (
                                        <p className="text-sm text-slate-400">No catalog pricing warnings detected.</p>
                                    ) : (
                                        catalogWarnings.map((warning) => (
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
                                                        Configured: {warning.configured_cost.toFixed(2)}
                                                    </span>
                                                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
                                                        Minimum: {warning.minimum_cost.toFixed(2)}
                                                    </span>
                                                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">
                                                        Model: {warning.model}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </AdminSubpage>
    );
}

function formatTimestamp(timestamp?: number | null): string {
    if (!timestamp) return "unknown";
    return new Date(timestamp * 1000).toLocaleString();
}

function humanizeAction(action: string): string {
    return action
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function formatMetadataValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value.join(", ");
    }
    if (typeof value === "number") {
        return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (value == null) {
        return "null";
    }
    return String(value);
}

function getAuthWarningChipClassName(action: string): string {
    if (action === "admin_login_lockout") {
        return "rounded-full border border-rose-300/20 bg-rose-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200";
    }
    if (action === "admin_login_admin_deactivated") {
        return "rounded-full border border-red-400/30 bg-red-400/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-red-200";
    }
    if (action === "admin_login_failure") {
        return "rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200";
    }
    return "rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200";
}

function getFailureSummaryChipClassName(summary: AdminAuthFailureSummaryItem): string {
    if (!summary.isActive) {
        return "rounded-full border border-red-400/30 bg-red-400/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-red-200";
    }
    if (summary.isLockedOut) {
        return "rounded-full border border-rose-300/20 bg-rose-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200";
    }
    return "rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200";
}

function formatWindow(windowSeconds: number): string {
    if (windowSeconds <= 0) return "n/a";
    if (windowSeconds % 3600 === 0) {
        const hours = windowSeconds / 3600;
        return hours === 1 ? "1 hour" : `${hours} hours`;
    }
    if (windowSeconds % 60 === 0) {
        const minutes = windowSeconds / 60;
        return minutes === 1 ? "1 minute" : `${minutes} minutes`;
    }
    return `${windowSeconds} seconds`;
}
