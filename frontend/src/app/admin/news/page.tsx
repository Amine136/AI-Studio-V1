"use client";

import { useCallback, useEffect, useState } from "react";

import AdminSubpage from "../_components/AdminSubpage";
import { api } from "../../../services/api";
import type { DashboardNewsItem, DashboardNewsUpsertRequest } from "../../../types";

const emptyNewsForm: DashboardNewsUpsertRequest = {
    badge: "AI News",
    title: "",
    description: "",
    linkLabel: "Learn more",
    linkHref: "/studio",
    tone: "blue",
    sortOrder: 0,
    isActive: true,
};

export default function AdminNewsPage() {
    const [items, setItems] = useState<DashboardNewsItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [newsForm, setNewsForm] = useState<DashboardNewsUpsertRequest>(emptyNewsForm);
    const [editingNewsId, setEditingNewsId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const loadItems = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const response = await api.getAdminDashboardNews();
            setItems((response.items ?? []).sort((a, b) => a.sortOrder - b.sortOrder || (b.updatedAt || 0) - (a.updatedAt || 0)));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to load dashboard news.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadItems();
    }, [loadItems]);

    const resetForm = useCallback(() => {
        setEditingNewsId(null);
        setNewsForm(emptyNewsForm);
        setError("");
    }, []);

    const handleFieldChange = useCallback(
        <K extends keyof DashboardNewsUpsertRequest>(key: K, value: DashboardNewsUpsertRequest[K]) => {
            setNewsForm((current) => ({ ...current, [key]: value }));
        },
        [],
    );

    const handleEdit = useCallback((item: DashboardNewsItem) => {
        setEditingNewsId(item.id);
        setError("");
        setNewsForm({
            badge: item.badge,
            title: item.title,
            description: item.description,
            linkLabel: item.linkLabel,
            linkHref: item.linkHref,
            tone: item.tone,
            sortOrder: item.sortOrder,
            isActive: item.isActive,
        });
    }, []);

    const handleSave = useCallback(async () => {
        setSaving(true);
        setError("");
        try {
            const saved = editingNewsId
                ? await api.updateAdminDashboardNews(editingNewsId, newsForm)
                : await api.createAdminDashboardNews(newsForm);

            setItems((current) => {
                const next = editingNewsId
                    ? current.map((item) => (item.id === saved.id ? saved : item))
                    : [...current, saved];
                return next.sort((a, b) => a.sortOrder - b.sortOrder || (b.updatedAt || 0) - (a.updatedAt || 0));
            });
            resetForm();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to save dashboard news.");
        } finally {
            setSaving(false);
        }
    }, [editingNewsId, newsForm, resetForm]);

    const handleDelete = useCallback(async (item: DashboardNewsItem) => {
        setSaving(true);
        setError("");
        try {
            await api.deleteAdminDashboardNews(item.id);
            setItems((current) => current.filter((entry) => entry.id !== item.id));
            if (editingNewsId === item.id) {
                resetForm();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to delete dashboard news.");
        } finally {
            setSaving(false);
        }
    }, [editingNewsId, resetForm]);

    return (
        <AdminSubpage title="Dashboard News" description="Manage the rotating dashboard cards now, and leave room here for future news mailing controls.">
            <section className="glass-card overflow-hidden animate-fade-in-up">
                <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-white">News Items</h2>
                        <p className="text-xs text-slate-500">These cards appear in Dashboard → Studio News.</p>
                    </div>
                    <span className="text-xs text-slate-500">{items.length} items</span>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="auth-loader" />
                    </div>
                ) : (
                    <div className="grid gap-6 px-5 py-5 xl:grid-cols-[1.15fr_0.85fr]">
                        <div className="space-y-3">
                            {items.length === 0 ? (
                                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5 text-sm text-slate-400">
                                    No dashboard news items yet.
                                </div>
                            ) : null}
                            {items.map((item) => (
                                <div key={item.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-200">
                                                    {item.badge || "News"}
                                                </span>
                                                <span className="text-[11px] text-slate-500">{formatRelativeTime(item.updatedAt ?? item.createdAt)}</span>
                                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${item.isActive ? "bg-emerald-400/10 text-emerald-300" : "bg-slate-400/10 text-slate-400"}`}>
                                                    {item.isActive ? "Active" : "Hidden"}
                                                </span>
                                            </div>
                                            <p className="mt-3 text-sm font-semibold text-white">{item.title}</p>
                                            <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
                                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                                                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1">Tone: {item.tone}</span>
                                                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1">Order: {item.sortOrder}</span>
                                                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1">Link: {item.linkHref}</span>
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <button onClick={() => handleEdit(item)} className="admin-gradient-btn px-3 py-2 text-xs">
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => void handleDelete(item)}
                                                className="rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-400/[0.12]"
                                                disabled={saving}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-white">{editingNewsId ? "Edit News Item" : "Create News Item"}</p>
                                    <p className="mt-1 text-xs text-slate-500">Future mailing controls can be added to this page.</p>
                                </div>
                                {editingNewsId ? (
                                    <button onClick={resetForm} className="text-xs font-semibold text-slate-300 hover:text-white">
                                        Cancel
                                    </button>
                                ) : null}
                            </div>

                            <div className="mt-5 space-y-4">
                                <label className="block">
                                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Badge</span>
                                    <select
                                        value={newsForm.badge}
                                        onChange={(event) => handleFieldChange("badge", event.target.value as DashboardNewsUpsertRequest["badge"])}
                                        className="w-full rounded-xl border border-white/10 bg-[#0f1525] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#adc6ff]/40"
                                    >
                                        <option value="AI News">AI News</option>
                                        <option value="Platform Updates">Platform Updates</option>
                                        <option value="New Features">New Features</option>
                                    </select>
                                </label>
                                <AdminInput label="Title" value={newsForm.title} onChange={(value) => handleFieldChange("title", value)} placeholder="Quick and Smart workflows are active" />
                                <AdminTextArea label="Description" value={newsForm.description} onChange={(value) => handleFieldChange("description", value)} placeholder="Short dashboard message..." />
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <AdminInput label="Link Label" value={newsForm.linkLabel} onChange={(value) => handleFieldChange("linkLabel", value)} placeholder="Learn more" />
                                    <AdminInput label="Link Href" value={newsForm.linkHref} onChange={(value) => handleFieldChange("linkHref", value)} placeholder="/studio" />
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="block">
                                        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Tone</span>
                                        <select
                                            value={newsForm.tone}
                                            onChange={(event) => handleFieldChange("tone", event.target.value as DashboardNewsUpsertRequest["tone"])}
                                            className="w-full rounded-xl border border-white/10 bg-[#0f1525] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#adc6ff]/40"
                                        >
                                            <option value="blue">Blue</option>
                                            <option value="purple">Purple</option>
                                            <option value="slate">Slate</option>
                                        </select>
                                    </label>
                                    <AdminInput
                                        label="Sort Order"
                                        value={String(newsForm.sortOrder)}
                                        onChange={(value) => handleFieldChange("sortOrder", Number.parseInt(value || "0", 10) || 0)}
                                        placeholder="0"
                                        type="number"
                                    />
                                </div>
                                <label className="flex items-center gap-3 rounded-xl border border-white/8 bg-[#0f1525] px-3 py-3 text-sm text-slate-200">
                                    <input
                                        type="checkbox"
                                        checked={newsForm.isActive}
                                        onChange={(event) => handleFieldChange("isActive", event.target.checked)}
                                        className="h-4 w-4 rounded border-white/20 bg-transparent"
                                    />
                                    Show this item on the dashboard
                                </label>
                                {error ? <p className="text-sm text-rose-300">{error}</p> : null}
                                <button
                                    onClick={() => void handleSave()}
                                    disabled={saving || !newsForm.title.trim()}
                                    className="admin-gradient-btn w-full justify-center py-3 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {saving ? "Saving..." : editingNewsId ? "Update News Item" : "Create News Item"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </AdminSubpage>
    );
}

function formatRelativeTime(timestamp?: number | null): string {
    if (!timestamp) return "Now";
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
}

function AdminInput({
    label,
    value,
    onChange,
    placeholder,
    type = "text",
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: "text" | "number";
}) {
    return (
        <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</span>
            <input
                type={type}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="w-full rounded-xl border border-white/10 bg-[#0f1525] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#adc6ff]/40"
            />
        </label>
    );
}

function AdminTextArea({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) {
    return (
        <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</span>
            <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                rows={5}
                className="w-full rounded-xl border border-white/10 bg-[#0f1525] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#adc6ff]/40"
            />
        </label>
    );
}
