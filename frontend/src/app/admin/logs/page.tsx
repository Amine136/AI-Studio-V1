"use client";

import { useEffect, useState } from "react";

import AdminSubpage from "../_components/AdminSubpage";
import { api } from "../../../services/api";
import type { AdminAuditLogItem } from "../../../types";

export default function AdminLogsPage() {
    const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;

        const loadLogs = async () => {
            setLoading(true);
            setError("");
            try {
                const response = await api.getAdminLogs({ limit: 100 });
                if (!cancelled) {
                    setLogs(response.logs ?? []);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Unable to load logs.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadLogs();

        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <AdminSubpage title="Admin Logs" description="This is the transparency layer for multi-admin operations and later investigations.">
            <section className="glass-card overflow-hidden animate-fade-in-up">
                <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-white">Audit Logs</h2>
                        <p className="text-xs text-slate-500">Action history with admin, target, and reason</p>
                    </div>
                    <span className="text-xs text-slate-500">{logs.length} logs</span>
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
                    <div className="divide-y divide-white/6">
                        {logs.map((log) => (
                            <div key={log.id} className="px-5 py-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-medium text-slate-100">{humanizeAction(log.action)}</p>
                                        <p className="mt-1 text-xs text-slate-400">
                                            {log.adminEmail} • {log.targetType}:{log.targetId}
                                        </p>
                                    </div>
                                    <span className="text-xs text-slate-500">{formatTimestamp(log.createdAt)}</span>
                                </div>
                                <p className="mt-2 text-sm text-slate-300">{log.reason}</p>
                                {log.metadata && Object.keys(log.metadata).length > 0 && (
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
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
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
