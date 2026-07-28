"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../services/api";
import type { FeedbackItem, FeedbackStatus } from "../../../types";

type StatusFilter = "all" | FeedbackStatus;

const CATEGORY_STYLES: Record<string, { icon: string; classes: string }> = {
    bug: { icon: "bug_report", classes: "bg-error/10 text-error border-error/20" },
    idea: { icon: "lightbulb", classes: "bg-primary/10 text-primary border-primary/20" },
    other: { icon: "forum", classes: "bg-secondary/10 text-secondary border-secondary/20" },
};

function formatTimestamp(timestamp?: number | null): string {
    if (!timestamp) return "unknown";
    return new Date(timestamp * 1000).toLocaleString();
}

export default function AdminFeedbackPage() {
    const [items, setItems] = useState<FeedbackItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [filter, setFilter] = useState<StatusFilter>("all");
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const itemsPerPage = 10;

    const loadItems = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const response = await api.getAdminFeedback();
            setItems(response.items ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load feedback.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadItems();
    }, [loadItems]);

    const filteredItems = useMemo(
        () => (filter === "all" ? items : items.filter((item) => item.status === filter)),
        [items, filter],
    );

    const newCount = useMemo(() => items.filter((item) => item.status === "new").length, [items]);

    const totalPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));
    const paginatedItems = useMemo(() => {
        const start = (page - 1) * itemsPerPage;
        return filteredItems.slice(start, start + itemsPerPage);
    }, [filteredItems, page, itemsPerPage]);

    const setStatusFilter = (next: StatusFilter) => {
        setFilter(next);
        setPage(1);
    };

    const toggleStatus = async (item: FeedbackItem) => {
        if (updatingId) return;
        setUpdatingId(item.id);
        try {
            const next: FeedbackStatus = item.status === "new" ? "handled" : "new";
            const updated = await api.updateAdminFeedbackStatus(item.id, next);
            setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update feedback.");
        } finally {
            setUpdatingId(null);
        }
    };

    if (loading) {
        return (
            <main className="flex-1 overflow-y-auto p-6 min-h-[calc(100vh-4rem)] flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    return (
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 custom-scrollbar relative">
            {/* Header Section */}
            <section className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8 sm:mb-10 max-w-[1440px] mx-auto">
                <div>
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-2">
                        <h2 className="font-headline-lg text-headline-lg text-primary">User Feedback</h2>
                        {newCount > 0 ? (
                            <span className="px-2 py-1 bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold rounded uppercase tracking-tighter">{newCount} New</span>
                        ) : null}
                    </div>
                    <p className="font-body-lg text-on-surface-variant max-w-2xl">Bug reports, ideas, and messages submitted from the in-app feedback form.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {(["all", "new", "handled"] as StatusFilter[]).map((option) => (
                        <button
                            key={option}
                            type="button"
                            onClick={() => setStatusFilter(option)}
                            className={`px-3 sm:px-4 py-2 rounded-lg font-label-caps text-label-caps border transition-colors ${
                                filter === option
                                    ? "bg-primary-container text-on-primary-container border-primary/20"
                                    : "text-on-surface-variant border-outline-variant hover:bg-surface-container-highest"
                            }`}
                        >
                            {option.toUpperCase()}
                        </button>
                    ))}
                </div>
            </section>

            {/* Content Canvas */}
            <div className="max-w-[1440px] mx-auto">
                <section className="nebula-glass rounded-2xl p-4 sm:p-6">
                    <div className="flex flex-wrap items-center gap-3 justify-between mb-6 pb-4 border-b border-outline-variant">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-primary">rate_review</span>
                            <h3 className="font-title-md text-title-md text-on-surface">Inbox</h3>
                        </div>
                        <span className="font-label-caps text-secondary bg-secondary/10 px-3 py-1 rounded-full border border-secondary/20">{filteredItems.length} ITEMS</span>
                    </div>

                    {error ? <p className="text-sm text-error mb-4">{error}</p> : null}

                    <div className="grid grid-cols-1 gap-4">
                        {paginatedItems.length === 0 ? (
                            <p className="text-sm text-on-surface-variant">No feedback here yet.</p>
                        ) : (
                            paginatedItems.map((item) => {
                                const category = CATEGORY_STYLES[item.category] ?? CATEGORY_STYLES.other;
                                const handled = item.status === "handled";
                                return (
                                    <div
                                        key={item.id}
                                        className={`group bg-surface-container-high rounded-lg p-5 border border-outline-variant transition-all ${
                                            handled ? "opacity-70" : "border-l-4 border-l-primary"
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-3 mb-2">
                                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border rounded text-[9px] font-bold tracking-widest uppercase ${category.classes}`}>
                                                        <span className="material-symbols-outlined text-[12px]">{category.icon}</span>
                                                        {item.category}
                                                    </span>
                                                    <span className="text-xs text-on-surface-variant">{formatTimestamp(item.createdAt)}</span>
                                                    <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-widest ${
                                                        handled
                                                            ? "bg-secondary/10 text-secondary border-secondary/20"
                                                            : "bg-primary/10 text-primary border-primary/20"
                                                    }`}>
                                                        {item.status}
                                                    </span>
                                                </div>
                                                <p className="text-on-surface font-body-sm whitespace-pre-wrap break-words mb-3">{item.message}</p>
                                                <div className="flex flex-wrap gap-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-label-caps text-[10px] text-on-surface-variant">FROM</span>
                                                        <span className="px-2 py-0.5 bg-surface-container-lowest rounded border border-outline-variant font-code-sm text-[11px] text-on-surface">{item.email || item.uid || "unknown"}</span>
                                                    </div>
                                                    {item.route ? (
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-label-caps text-[10px] text-on-surface-variant">ROUTE</span>
                                                            <span className="px-2 py-0.5 bg-surface-container-lowest rounded border border-outline-variant font-code-sm text-[11px] text-secondary">{item.route}</span>
                                                        </div>
                                                    ) : null}
                                                    {item.language ? (
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-label-caps text-[10px] text-on-surface-variant">LANG</span>
                                                            <span className="px-2 py-0.5 bg-surface-container-lowest rounded border border-outline-variant font-code-sm text-[11px] text-on-surface">{item.language}</span>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => void toggleStatus(item)}
                                                disabled={updatingId === item.id}
                                                className={`shrink-0 px-4 py-2 rounded-lg font-label-caps text-label-caps border transition-colors ${
                                                    updatingId === item.id
                                                        ? "opacity-60 cursor-not-allowed text-on-surface-variant border-outline-variant"
                                                        : handled
                                                            ? "text-on-surface-variant border-outline-variant hover:bg-surface-container-highest"
                                                            : "bg-primary-container text-on-primary-container border-primary/20 hover:opacity-90"
                                                }`}
                                            >
                                                {handled ? "Reopen" : "Mark Handled"}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {totalPages > 1 ? (
                        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-outline-variant">
                            <button
                                type="button"
                                onClick={() => setPage((current) => Math.max(1, current - 1))}
                                disabled={page <= 1}
                                className="px-3 py-1.5 rounded-lg border border-outline-variant font-label-caps text-label-caps text-on-surface-variant disabled:opacity-40 hover:bg-surface-container-highest transition-colors"
                            >
                                Prev
                            </button>
                            <span className="text-xs text-on-surface-variant">Page {page} / {totalPages}</span>
                            <button
                                type="button"
                                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                                disabled={page >= totalPages}
                                className="px-3 py-1.5 rounded-lg border border-outline-variant font-label-caps text-label-caps text-on-surface-variant disabled:opacity-40 hover:bg-surface-container-highest transition-colors"
                            >
                                Next
                            </button>
                        </div>
                    ) : null}
                </section>
            </div>
        </main>
    );
}
