"use client";

import { useEffect, useState, useMemo } from "react";
import { api } from "../../../services/api";
import type { AdminAuditLogItem } from "../../../types";

export default function AdminLogsPage() {
    const [logs, setLogs] = useState<AdminAuditLogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const logsPerPage = 10;

    useEffect(() => {
        let cancelled = false;

        const loadLogs = async () => {
            setLoading(true);
            setError("");
            try {
                // Request more logs to allow client-side pagination
                const response = await api.getAdminLogs({ limit: 1000 });
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

    // Pagination Logic
    const totalPages = Math.ceil(logs.length / logsPerPage);
    const paginatedLogs = useMemo(() => {
        const start = (currentPage - 1) * logsPerPage;
        return logs.slice(start, start + logsPerPage);
    }, [logs, currentPage, logsPerPage]);

    if (loading && logs.length === 0) {
        return (
            <main className="flex-1 overflow-y-auto p-8 h-[calc(100vh-64px)] flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    return (
        <main className="flex-1 overflow-y-auto p-8 custom-scrollbar min-h-screen relative">
            <div className="max-w-[1440px] mx-auto space-y-6 pb-10">
                {/* Page Title & Stats Overview */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-2">
                    <div>
                        <h2 className="font-headline-lg text-headline-lg font-bold text-on-surface tracking-tight">Audit Logs</h2>
                        <p className="text-on-surface-variant font-body-sm">Tracking administrative activities across the Obsidian ecosystem.</p>
                    </div>
                </div>

                {error && (
                    <div className="p-4 rounded-lg border border-error-container/30 bg-error-container/10 text-error">
                        {error}
                    </div>
                )}

                {/* High Density Audit Table */}
                <div className="glass-panel rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-surface-container-highest/50 border-b border-outline-variant">
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Event & Status</th>
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Administrator</th>
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Metadata</th>
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant">Timestamp</th>
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-outline-variant">
                                {logs.length === 0 && !loading && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-on-surface-variant font-body-sm italic">
                                            No audit logs found.
                                        </td>
                                    </tr>
                                )}
                                {paginatedLogs.map((log) => {
                                    const { icon, colorClass, bgClass } = getActionStyling(log.action);
                                    
                                    return (
                                        <tr key={log.id} className="hover:bg-surface-variant/30 transition-colors group cursor-pointer" onClick={() => console.log('Log details:', log)}>
                                            {/* Event & Status */}
                                            <td className="px-6 py-6">
                                                <div className="flex items-center gap-6">
                                                    <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${bgClass}`}>
                                                        <span className={`material-symbols-outlined text-[18px] ${colorClass}`}>{icon}</span>
                                                    </div>
                                                    <div>
                                                        <p className="font-body-sm font-semibold text-on-surface capitalize truncate max-w-[200px] xl:max-w-[300px]">
                                                            {humanizeAction(log.action)}
                                                        </p>
                                                        <p className="text-[12px] text-on-surface-variant truncate max-w-[200px] xl:max-w-[300px]" title={log.reason || "No reason provided"}>
                                                            {log.reason || "No reason provided"}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            
                                            {/* Administrator */}
                                            <td className="px-6 py-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-7 h-7 rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-bold text-on-surface uppercase shrink-0">
                                                        {getInitials(log.adminEmail)}
                                                    </div>
                                                    <span className="font-code-sm text-[13px] text-primary truncate max-w-[150px]" title={log.adminEmail}>
                                                        {log.adminEmail.split('@')[0]}
                                                    </span>
                                                </div>
                                            </td>
                                            
                                            {/* Metadata */}
                                            <td className="px-6 py-6">
                                                <div className="flex flex-wrap gap-2 max-w-[250px]">
                                                    <span className="px-2 py-[2px] bg-surface-container-highest rounded text-[10px] font-code-sm border border-outline-variant text-on-surface-variant whitespace-nowrap">
                                                        TARGET: {log.targetType}
                                                    </span>
                                                    {log.targetId && (
                                                        <span className="px-2 py-[2px] bg-surface-container-highest rounded text-[10px] font-code-sm border border-outline-variant text-on-surface-variant whitespace-nowrap truncate max-w-[120px]" title={log.targetId}>
                                                            ID: {log.targetId}
                                                        </span>
                                                    )}
                                                    {log.metadata && Object.entries(log.metadata).slice(0, 2).map(([key, value]) => (
                                                        <span key={key} className="px-2 py-[2px] bg-surface-container-highest rounded text-[10px] font-code-sm border border-outline-variant text-on-surface-variant whitespace-nowrap">
                                                            {key.toUpperCase()}: {formatMetadataValue(value)}
                                                        </span>
                                                    ))}
                                                    {log.metadata && Object.keys(log.metadata).length > 2 && (
                                                        <span className="px-2 py-[2px] bg-surface-container-highest rounded text-[10px] font-code-sm border border-outline-variant text-on-surface-variant">
                                                            +{Object.keys(log.metadata).length - 2} more
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            
                                            {/* Timestamp */}
                                            <td className="px-6 py-6 whitespace-nowrap">
                                                <p className="font-code-sm text-[12px] text-on-surface">{formatDate(log.createdAt)}</p>
                                                <p className="text-[11px] text-on-surface-variant">{formatTime(log.createdAt)}</p>
                                            </td>
                                            
                                            {/* Action */}
                                            <td className="px-6 py-6 text-right">
                                                <button 
                                                    className="p-2 hover:bg-surface-variant rounded transition-colors"
                                                    onClick={(e) => { e.stopPropagation(); alert(JSON.stringify(log, null, 2)); }}
                                                    title="View Raw Log"
                                                >
                                                    <span className="material-symbols-outlined text-[20px] text-on-surface-variant">more_vert</span>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    
                    {/* Pagination/Footer */}
                    {logs.length > 0 && (
                        <div className="p-6 bg-surface-container-low flex items-center justify-between border-t border-outline-variant">
                            <p className="text-[12px] font-body-sm text-on-surface-variant hidden sm:block">
                                Showing {(currentPage - 1) * logsPerPage + 1} to {Math.min(currentPage * logsPerPage, logs.length)} of {logs.length} events
                            </p>
                            <div className="flex items-center gap-2 ml-auto">
                                <button 
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                    className="w-8 h-8 flex items-center justify-center rounded border border-outline-variant hover:bg-surface-variant text-on-surface-variant transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                                </button>
                                
                                <button className="w-8 h-8 flex items-center justify-center rounded bg-primary text-on-primary font-code-sm text-[12px]">
                                    {currentPage}
                                </button>
                                
                                <span className="px-2 text-on-surface-variant text-[12px]">of {totalPages}</span>
                                
                                <button 
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={currentPage === totalPages}
                                    className="w-8 h-8 flex items-center justify-center rounded border border-outline-variant hover:bg-surface-variant text-on-surface-variant transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            {/* Visual Polish: Decorative Elements */}
            <div className="absolute top-0 right-0 -z-10 w-[500px] h-[500px] bg-tertiary/5 rounded-full blur-[100px] pointer-events-none"></div>
        </main>
    );
}

// Helper Functions
function getInitials(email: string): string {
    if (!email) return "??";
    const parts = email.split("@")[0].split(/[\._-]/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return email.substring(0, 2).toUpperCase();
}

function formatDate(timestamp?: number | null): string {
    if (!timestamp) return "unknown date";
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0];
}

function formatTime(timestamp?: number | null): string {
    if (!timestamp) return "unknown time";
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[1].substring(0, 8) + " UTC";
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

function getActionStyling(action: string): { icon: string, colorClass: string, bgClass: string } {
    const actionLower = action.toLowerCase();
    
    if (actionLower.includes('login') || actionLower.includes('auth')) {
        return { icon: 'login', colorClass: 'text-tertiary', bgClass: 'bg-tertiary/10' };
    }
    if (actionLower.includes('delete') || actionLower.includes('remove') || actionLower.includes('reset') || actionLower.includes('fail')) {
        return { icon: 'warning', colorClass: 'text-error', bgClass: 'bg-error/10' };
    }
    if (actionLower.includes('update') || actionLower.includes('edit') || actionLower.includes('change')) {
        return { icon: 'edit_note', colorClass: 'text-secondary', bgClass: 'bg-secondary/10' };
    }
    if (actionLower.includes('create') || actionLower.includes('add') || actionLower.includes('invite')) {
        return { icon: 'add_circle', colorClass: 'text-primary', bgClass: 'bg-primary/10' };
    }
    if (actionLower.includes('model') || actionLower.includes('weight')) {
        return { icon: 'settings_input_component', colorClass: 'text-primary', bgClass: 'bg-primary/10' };
    }
    if (actionLower.includes('policy') || actionLower.includes('permission')) {
        return { icon: 'rule', colorClass: 'text-secondary', bgClass: 'bg-secondary/10' };
    }
    
    // Default styling
    return { icon: 'manage_history', colorClass: 'text-on-surface-variant', bgClass: 'bg-surface-container-highest' };
}
