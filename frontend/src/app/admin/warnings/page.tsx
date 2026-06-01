"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../services/api";
import type { AdminAuditLogItem, AdminAuthFailureSummaryItem, CatalogWarningItem } from "../../../types";

const AUTH_WARNING_ACTIONS = new Set([
    "admin_login_lockout",
    "admin_login_success",
    "admin_login_admin_deactivated",
]);

function formatCreditAmount(value: number): string {
    if (value > 0 && value < 0.01) {
        return value.toFixed(3);
    }
    return value.toFixed(2);
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

export default function AdminWarningsPage() {
    const [catalogWarnings, setCatalogWarnings] = useState<CatalogWarningItem[]>([]);
    const [authWarnings, setAuthWarnings] = useState<AdminAuditLogItem[]>([]);
    const [authFailureSummaries, setAuthFailureSummaries] = useState<AdminAuthFailureSummaryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Pagination state
    const [authEventsPage, setAuthEventsPage] = useState(1);
    const [authFailuresPage, setAuthFailuresPage] = useState(1);
    const itemsPerPage = 10;

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

    // Pagination Logic
    const authEventsTotalPages = Math.max(1, Math.ceil(authWarnings.length / itemsPerPage));
    const paginatedAuthEvents = useMemo(() => {
        const start = (authEventsPage - 1) * itemsPerPage;
        return authWarnings.slice(start, start + itemsPerPage);
    }, [authWarnings, authEventsPage, itemsPerPage]);

    const authFailuresTotalPages = Math.max(1, Math.ceil(authFailureSummaries.length / itemsPerPage));
    const paginatedAuthFailures = useMemo(() => {
        const start = (authFailuresPage - 1) * itemsPerPage;
        return authFailureSummaries.slice(start, start + itemsPerPage);
    }, [authFailureSummaries, authFailuresPage, itemsPerPage]);

    if (loading) {
        return (
            <main className="flex-1 overflow-y-auto p-6 min-h-[calc(100vh-4rem)] flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    if (error) {
        return (
            <main className="flex-1 overflow-y-auto p-6 min-h-[calc(100vh-4rem)] flex items-center justify-center">
                <p className="text-error">{error}</p>
            </main>
        );
    }

    return (
        <main className="flex-1 overflow-y-auto p-6 custom-scrollbar relative">
            {/* Header Section */}
            <section className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10 max-w-[1440px] mx-auto">
                <div>
                    <div className="flex items-center gap-4 mb-2">
                        <h2 className="font-headline-lg text-headline-lg text-primary">Admin Warnings</h2>
                        <span className="px-2 py-1 bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold rounded uppercase tracking-tighter">Critical View</span>
                    </div>
                    <p className="font-body-lg text-on-surface-variant max-w-2xl">Operational warnings and security signals that need attention.</p>
                </div>
            </section>

            {/* Content Canvas */}
            <div className="space-y-8 max-w-[1440px] mx-auto">
                {/* Catalog Warnings Section */}
                <section className="nebula-glass rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6 pb-4 border-b border-outline-variant">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-error">inventory_2</span>
                            <h3 className="font-title-md text-title-md text-on-surface">Catalog Warnings</h3>
                        </div>
                        <span className="font-label-caps text-secondary bg-secondary/10 px-3 py-1 rounded-full border border-secondary/20">{catalogWarnings.length} ACTIVE</span>
                    </div>
                    <p className="text-xs text-on-surface-variant mb-6 -mt-4">Model minimum pricing below enforced backend floors</p>
                    
                    <div className="grid grid-cols-1 gap-4">
                        {catalogWarnings.length === 0 ? (
                            <p className="text-sm text-on-surface-variant">No catalog pricing warnings detected.</p>
                        ) : (
                            catalogWarnings.map(warning => (
                                <div key={`${warning.task}-${warning.model}`} className="group bg-surface-container-high border-l-4 border-l-secondary rounded-lg p-5 border border-outline-variant hover:bg-surface-bright transition-all">
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-background flex items-center justify-center shrink-0 border border-outline-variant">
                                            <span className="material-symbols-outlined text-secondary opacity-70 group-hover:scale-110 transition-transform">image</span>
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-1">
                                                <span className="px-1.5 py-0.5 bg-secondary/10 text-secondary border border-secondary/20 rounded text-[9px] font-bold tracking-widest uppercase">{warning.task}</span>
                                                <h5 className="font-bold text-on-surface text-lg">{warning.display_name || warning.model}</h5>
                                            </div>
                                            <p className="text-on-surface mb-4 font-body-sm">{warning.message}</p>
                                            <div className="flex flex-wrap gap-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-label-caps text-[10px] text-on-surface-variant">CONFIGURED</span>
                                                    <span className="px-2 py-0.5 bg-surface-container-lowest rounded border border-outline-variant font-code-sm text-[11px] text-error">{formatCreditAmount(warning.configured_cost)}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-label-caps text-[10px] text-on-surface-variant">MINIMUM</span>
                                                    <span className="px-2 py-0.5 bg-surface-container-lowest rounded border border-outline-variant font-code-sm text-[11px] text-on-surface">{formatCreditAmount(warning.minimum_cost)}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-label-caps text-[10px] text-on-surface-variant">MODEL</span>
                                                    <span className="px-2 py-0.5 bg-surface-container-lowest rounded border border-outline-variant font-code-sm text-[11px] text-secondary">{warning.model}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <button className="p-2 text-on-surface-variant hover:text-on-surface transition-colors">
                                            <span className="material-symbols-outlined">more_vert</span>
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                <section className="nebula-glass rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6 pb-4 border-b border-outline-variant">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-primary">analytics</span>
                            <h3 className="font-title-md text-title-md text-on-surface">Warnings Overview</h3>
                        </div>
                        <span className="font-label-caps text-on-surface-variant bg-surface-container-highest px-3 py-1 rounded-full">{totalWarnings} ITEMS</span>
                    </div>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Admin Auth Events */}
                        <div className="bg-surface-container-low rounded-lg border border-outline-variant p-5">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h4 className="font-bold text-on-surface">Admin Auth Events</h4>
                                    <p className="text-xs text-on-surface-variant mt-0.5">Successful sign-ins, lockouts, and critical deactivations</p>
                                </div>
                                <span className="px-2 py-0.5 bg-primary-container/20 text-primary border border-primary/30 rounded text-[10px] font-bold uppercase tracking-wider">{authWarnings.length} EVENTS</span>
                            </div>
                            <div className="space-y-3">
                                {authWarnings.length === 0 ? (
                                    <p className="text-sm text-on-surface-variant">No admin auth events recorded.</p>
                                ) : (
                                    paginatedAuthEvents.map((log) => (
                                        <div key={log.id} className="event-card pb-4 border-b border-outline-variant/30 last:border-0 last:pb-0">
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="px-2 py-0.5 bg-tertiary-container/30 text-tertiary border border-tertiary/30 rounded-full text-[10px] font-bold uppercase tracking-tighter">{humanizeAction(log.action)}</span>
                                                    <span className="text-xs font-code-sm text-on-surface-variant">{log.targetId}</span>
                                                </div>
                                                <span className="text-[10px] font-code-sm text-on-surface-variant">{formatTimestamp(log.createdAt)}</span>
                                            </div>
                                            <p className="font-medium text-sm text-on-surface mb-3">{log.reason}</p>
                                            <div className="flex flex-wrap gap-2">
                                                {log.metadata && Object.entries(log.metadata).map(([key, value]) => (
                                                    <span key={`${log.id}-${key}`} className="px-2 py-1 bg-surface-container-highest rounded border border-outline-variant font-code-sm text-[11px] text-on-surface-variant">
                                                        {key}: {formatMetadataValue(value)}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                            
                            {/* Pagination Footer */}
                            {authWarnings.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-outline-variant flex items-center justify-between">
                                    <p className="text-[11px] font-body-sm text-on-surface-variant">
                                        Showing {(authEventsPage - 1) * itemsPerPage + 1} to {Math.min(authEventsPage * itemsPerPage, authWarnings.length)} of {authWarnings.length} events
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => setAuthEventsPage(prev => Math.max(1, prev - 1))}
                                            disabled={authEventsPage === 1}
                                            className="w-7 h-7 flex items-center justify-center rounded border border-outline-variant hover:bg-surface-variant text-on-surface-variant transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                                        </button>
                                        <button className="w-7 h-7 flex items-center justify-center rounded bg-primary text-on-primary font-code-sm text-[11px]">
                                            {authEventsPage}
                                        </button>
                                        <span className="text-on-surface-variant text-[11px] px-1">of {authEventsTotalPages}</span>
                                        <button 
                                            onClick={() => setAuthEventsPage(prev => Math.min(authEventsTotalPages, prev + 1))}
                                            disabled={authEventsPage === authEventsTotalPages}
                                            className="w-7 h-7 flex items-center justify-center rounded border border-outline-variant hover:bg-surface-variant text-on-surface-variant transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Admin Wrong Password Counts */}
                        <div className="bg-surface-container-low rounded-lg border border-outline-variant p-5 flex flex-col">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h4 className="font-bold text-on-surface">Admin Wrong Password Counts</h4>
                                    <p className="text-xs text-on-surface-variant mt-0.5">Aggregated failed-password counts for real admin usernames</p>
                                </div>
                                <span className="px-2 py-0.5 bg-on-surface-variant/10 text-on-surface-variant border border-on-surface-variant/20 rounded text-[10px] font-bold uppercase tracking-wider">{authFailureSummaries.length} ACTIVE</span>
                            </div>
                            
                            <div className="flex-1 flex flex-col space-y-3">
                                {authFailureSummaries.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center py-10 opacity-60">
                                        <span className="material-symbols-outlined text-4xl mb-4 text-on-surface-variant">verified_user</span>
                                        <p className="text-sm text-on-surface-variant font-medium">No active wrong-password counters for admin usernames.</p>
                                    </div>
                                ) : (
                                    paginatedAuthFailures.map((summary) => (
                                        <div key={summary.username} className="event-card pb-4 border-b border-outline-variant/30 last:border-0 last:pb-0">
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tighter ${summary.isActive ? "bg-emerald-300/10 text-emerald-200 border border-emerald-300/20" : "bg-red-400/15 text-red-200 border border-red-400/30"}`}>
                                                        {summary.isActive ? "Tracked" : "Deactivated"}
                                                    </span>
                                                    {summary.isLockedOut && (
                                                        <span className="px-2 py-0.5 rounded-full bg-error-container text-error border border-error text-[10px] font-bold uppercase tracking-tighter">
                                                            Locked Out
                                                        </span>
                                                    )}
                                                    <span className="text-xs font-code-sm text-on-surface-variant">{summary.username}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                <span className="px-2 py-1 bg-surface-container-highest rounded border border-outline-variant font-code-sm text-[11px] text-on-surface-variant">
                                                    failures: {summary.wrongPasswordFailures}
                                                </span>
                                                <span className="px-2 py-1 bg-surface-container-highest rounded border border-outline-variant font-code-sm text-[11px] text-on-surface-variant">
                                                    lockout threshold: {summary.lockoutThreshold}
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                            
                            {/* Pagination Footer */}
                            {authFailureSummaries.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-outline-variant flex items-center justify-between mt-auto">
                                    <p className="text-[11px] font-body-sm text-on-surface-variant">
                                        Showing {(authFailuresPage - 1) * itemsPerPage + 1} to {Math.min(authFailuresPage * itemsPerPage, authFailureSummaries.length)} of {authFailureSummaries.length} events
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => setAuthFailuresPage(prev => Math.max(1, prev - 1))}
                                            disabled={authFailuresPage === 1}
                                            className="w-7 h-7 flex items-center justify-center rounded border border-outline-variant hover:bg-surface-variant text-on-surface-variant transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                                        </button>
                                        <button className="w-7 h-7 flex items-center justify-center rounded bg-primary text-on-primary font-code-sm text-[11px]">
                                            {authFailuresPage}
                                        </button>
                                        <span className="text-on-surface-variant text-[11px] px-1">of {authFailuresTotalPages}</span>
                                        <button 
                                            onClick={() => setAuthFailuresPage(prev => Math.min(authFailuresTotalPages, prev + 1))}
                                            disabled={authFailuresPage === authFailuresTotalPages}
                                            className="w-7 h-7 flex items-center justify-center rounded border border-outline-variant hover:bg-surface-variant text-on-surface-variant transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* Footer Visual */}
                <footer className="mt-12 text-center pb-8 border-t border-outline-variant pt-8">
                    <div className="flex justify-center gap-8">
                        <div className="flex flex-col items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-tertiary"></div>
                            <span className="text-[9px] uppercase font-bold text-tertiary">Node Alpha Online</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-secondary"></div>
                            <span className="text-[9px] uppercase font-bold text-secondary">Secure Shell Active</span>
                        </div>
                    </div>
                </footer>
            </div>
            
            {/* Floating Background Elements for Depth */}
            <div className="absolute top-0 right-0 -z-10 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 -z-10 w-[400px] h-[400px] bg-secondary/5 rounded-full blur-[100px] pointer-events-none"></div>
        </main>
    );
}
