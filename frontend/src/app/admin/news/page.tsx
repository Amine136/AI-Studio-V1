"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../services/api";
import type { DashboardNewsItem, DashboardNewsUpsertRequest } from "../../../types";

const emptyNewsForm: DashboardNewsUpsertRequest = {
    badge: "AI News",
    title: "",
    titleFr: "",
    titleAr: "",
    description: "",
    descriptionFr: "",
    descriptionAr: "",
    linkLabel: "Learn more",
    linkLabelFr: "",
    linkLabelAr: "",
    linkHref: "/studio",
    tone: "blue",
    sortOrder: 0,
    isActive: true,
};

// Text fields that have per-language variants edited via the EN/FR/AR tabs.
type NewsLang = "en" | "fr" | "ar";
type NewsTextField =
    | "title" | "titleFr" | "titleAr"
    | "description" | "descriptionFr" | "descriptionAr"
    | "linkLabel" | "linkLabelFr" | "linkLabelAr"
    | "linkHref";

const NEWS_LANG_TABS: { id: NewsLang; label: string }[] = [
    { id: "en", label: "English" },
    { id: "fr", label: "Français" },
    { id: "ar", label: "العربية" },
];

// Maps the active tab to the matching form field for a given base field.
function langField(base: "title" | "description" | "linkLabel", lang: NewsLang): NewsTextField {
    if (lang === "fr") return `${base}Fr` as NewsTextField;
    if (lang === "ar") return `${base}Ar` as NewsTextField;
    return base;
}

export default function AdminNewsPage() {
    const [items, setItems] = useState<DashboardNewsItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [newsForm, setNewsForm] = useState<DashboardNewsUpsertRequest>(emptyNewsForm);
    const [editingNewsId, setEditingNewsId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [langTab, setLangTab] = useState<NewsLang>("en");

    const setTextField = useCallback((key: NewsTextField, value: string) => {
        setNewsForm((current) => ({ ...current, [key]: value }) as DashboardNewsUpsertRequest);
    }, []);

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
        setLangTab("en");
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
        setLangTab("en");
        setNewsForm({
            badge: item.badge,
            title: item.title,
            titleFr: item.titleFr ?? "",
            titleAr: item.titleAr ?? "",
            description: item.description,
            descriptionFr: item.descriptionFr ?? "",
            descriptionAr: item.descriptionAr ?? "",
            linkLabel: item.linkLabel,
            linkLabelFr: item.linkLabelFr ?? "",
            linkLabelAr: item.linkLabelAr ?? "",
            linkHref: item.linkHref,
            tone: item.tone,
            sortOrder: item.sortOrder,
            isActive: item.isActive,
        });
        
        // Scroll to form (for mobile/smaller screens)
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleSave = useCallback(async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        
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
        if (!window.confirm("Are you sure you want to delete this news item?")) return;
        
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

    if (loading && items.length === 0) {
        return (
            <main className="flex-1 overflow-y-auto p-8 h-[calc(100vh-64px)] flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    return (
        <main className="flex-1 overflow-y-auto p-8 h-[calc(100vh-64px)] custom-scrollbar relative">
            <div className="max-w-[1440px] mx-auto grid grid-cols-1 md:grid-cols-12 gap-8 pb-10">
                
                {/* Header Section */}
                <div className="col-span-1 md:col-span-12 mb-4">
                    <h2 className="text-headline-lg font-headline-lg text-on-background">Dashboard News</h2>
                    <p className="text-body-lg font-body-lg text-on-surface-variant mt-1">Manage the rotating dashboard cards now, and leave room here for future news mailing controls.</p>
                </div>

                {/* Left Column: News Items Registry */}
                <div className="col-span-1 md:col-span-8 space-y-6">
                    <div className="flex justify-between items-end mb-2">
                        <h3 className="text-title-md font-title-md text-on-surface">News Items</h3>
                        <span className="text-label-caps font-label-caps text-on-surface-variant">{items.length} items currently listed</span>
                    </div>

                    {/* Registry Container */}
                    <div className="glass-panel rounded-lg p-6">
                        <div className="space-y-4">
                            {error && <p className="text-sm text-error mb-4">{error}</p>}
                            
                            {items.length === 0 ? (
                                <p className="text-body-sm text-on-surface-variant italic">No dashboard news items yet.</p>
                            ) : (
                                items.map((item) => (
                                    <div key={item.id} className="news-card glass-panel rounded-lg p-4 border border-outline-variant/30 transition-all flex flex-col xl:flex-row justify-between items-start gap-4 hover:-translate-y-[2px]">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-4 mb-2">
                                                <span className="px-2 py-0.5 rounded-full bg-surface-container-highest text-[10px] font-label-caps text-on-surface border border-outline uppercase">
                                                    {item.badge || "News"}
                                                </span>
                                                <span className="text-label-caps font-label-caps text-on-surface-variant opacity-60">
                                                    {formatRelativeTime(item.updatedAt ?? item.createdAt)}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-label-caps ${item.isActive ? "bg-tertiary/10 text-tertiary border border-tertiary/20" : "bg-outline-variant/30 text-on-surface-variant"}`}>
                                                    {item.isActive ? "ACTIVE" : "HIDDEN"}
                                                </span>
                                            </div>
                                            <h4 className="text-body-lg font-bold text-primary mb-1">{item.title}</h4>
                                            <p className="text-body-sm text-on-surface-variant mb-4">{item.description}</p>
                                            
                                            <div className="flex flex-wrap gap-2">
                                                <span className="px-2 py-1 bg-surface-container-low border border-outline-variant rounded text-[11px] font-code-sm text-secondary">
                                                    Tone: {item.tone}
                                                </span>
                                                <span className="px-2 py-1 bg-surface-container-low border border-outline-variant rounded text-[11px] font-code-sm text-on-surface-variant">
                                                    Order: {item.sortOrder}
                                                </span>
                                                <span className="px-2 py-1 bg-surface-container-low border border-outline-variant rounded text-[11px] font-code-sm text-on-surface-variant">
                                                    Link: {item.linkHref}
                                                </span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex xl:flex-col gap-2 shrink-0 w-full xl:w-auto xl:ml-6">
                                            <button 
                                                onClick={() => handleEdit(item)}
                                                disabled={saving}
                                                className="flex-1 xl:flex-none px-4 py-1.5 bg-secondary-container text-on-secondary-container rounded-lg text-label-caps hover:brightness-110 transition-all disabled:opacity-50"
                                            >
                                                Edit
                                            </button>
                                            <button 
                                                onClick={() => void handleDelete(item)}
                                                disabled={saving}
                                                className="flex-1 xl:flex-none px-4 py-1.5 bg-error-container/30 text-error rounded-lg text-label-caps hover:bg-error-container/50 transition-all disabled:opacity-50"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column: Create News Item Form */}
                <div className="col-span-1 md:col-span-4">
                    <div className="glass-panel rounded-lg p-6 sticky top-6">
                        <div className="flex justify-between items-start mb-1">
                            <h3 className="text-title-md font-title-md text-on-surface">{editingNewsId ? "Edit News Item" : "Create News Item"}</h3>
                            {editingNewsId && (
                                <button onClick={resetForm} className="text-[11px] font-label-caps text-on-surface-variant hover:text-white transition-colors">
                                    CANCEL
                                </button>
                            )}
                        </div>
                        <p className="text-body-sm text-on-surface-variant mb-6">Future mailing controls can be added to this page.</p>
                        
                        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-label-caps font-label-caps text-on-surface-variant">BADGE</label>
                                <select 
                                    value={newsForm.badge}
                                    onChange={(e) => handleFieldChange("badge", e.target.value as any)}
                                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-sm focus:ring-2 focus:ring-primary/50 outline-none appearance-none"
                                >
                                    <option value="AI News">AI News</option>
                                    <option value="Platform Updates">Platform Updates</option>
                                    <option value="New Features">New Features</option>
                                    <option value="Maintenance">Maintenance</option>
                                </select>
                            </div>
                            
                            {/* Language tabs — English is required; FR/AR are optional and
                                fall back to English on the dashboard when left blank. */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest p-1">
                                    {NEWS_LANG_TABS.map((tab) => {
                                        const active = langTab === tab.id;
                                        return (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                onClick={() => setLangTab(tab.id)}
                                                className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-label-caps transition-all ${active ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"}`}
                                            >
                                                {tab.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                {langTab !== "en" && (
                                    <p className="text-[11px] text-on-surface-variant opacity-70">
                                        Optional — leave blank to show the English text for {langTab === "fr" ? "French" : "Arabic"} users.
                                    </p>
                                )}
                            </div>

                            <div className="space-y-1">
                                <label className="text-label-caps font-label-caps text-on-surface-variant">
                                    TITLE {langTab !== "en" && <span className="opacity-60">({langTab.toUpperCase()})</span>}
                                </label>
                                <input
                                    required={langTab === "en"}
                                    value={(newsForm[langField("title", langTab)] as string) ?? ""}
                                    onChange={(e) => setTextField(langField("title", langTab), e.target.value)}
                                    dir={langTab === "ar" ? "rtl" : "ltr"}
                                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-sm focus:ring-2 focus:ring-primary/50 outline-none"
                                    placeholder={langTab === "en" ? "Quick and Smart workflows are active" : "Leave blank to use English"}
                                    type="text"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-label-caps font-label-caps text-on-surface-variant">
                                    DESCRIPTION {langTab !== "en" && <span className="opacity-60">({langTab.toUpperCase()})</span>}
                                </label>
                                <textarea
                                    value={(newsForm[langField("description", langTab)] as string) ?? ""}
                                    onChange={(e) => setTextField(langField("description", langTab), e.target.value)}
                                    dir={langTab === "ar" ? "rtl" : "ltr"}
                                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-sm focus:ring-2 focus:ring-primary/50 outline-none resize-none"
                                    placeholder={langTab === "en" ? "Short dashboard message..." : "Leave blank to use English"}
                                    rows={3}
                                ></textarea>
                            </div>
                            
                            <div className="flex items-center justify-between pt-2">
                                <label className="text-label-caps font-label-caps text-on-surface">ACTION LINK</label>
                                {(newsForm.linkLabel || newsForm.linkHref) && (
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            handleFieldChange("linkLabel", "");
                                            setTextField("linkLabelFr", "");
                                            setTextField("linkLabelAr", "");
                                            handleFieldChange("linkHref", "");
                                        }}
                                        className="text-[11px] font-label-caps text-error hover:text-error/80 transition-colors"
                                    >
                                        Remove Link
                                    </button>
                                )}
                            </div>
                            
                            {(newsForm.linkLabel || newsForm.linkHref) ? (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-label-caps font-label-caps text-on-surface-variant">
                                            LINK LABEL {langTab !== "en" && <span className="opacity-60">({langTab.toUpperCase()})</span>}
                                        </label>
                                        <input
                                            value={(newsForm[langField("linkLabel", langTab)] as string) ?? ""}
                                            onChange={(e) => setTextField(langField("linkLabel", langTab), e.target.value)}
                                            dir={langTab === "ar" ? "rtl" : "ltr"}
                                            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-sm focus:ring-2 focus:ring-primary/50 outline-none"
                                            placeholder={langTab === "en" ? "Learn more" : "Leave blank to use English"}
                                            type="text"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-label-caps font-label-caps text-on-surface-variant">LINK HREF</label>
                                        <input 
                                            value={newsForm.linkHref}
                                            onChange={(e) => handleFieldChange("linkHref", e.target.value)}
                                            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-sm focus:ring-2 focus:ring-primary/50 outline-none" 
                                            placeholder="/studio" 
                                            type="text" 
                                        />
                                    </div>
                                </div>
                            ) : (
                                <button 
                                    type="button"
                                    onClick={() => {
                                        handleFieldChange("linkLabel", "Learn more");
                                        handleFieldChange("linkHref", "/studio");
                                    }}
                                    className="w-full py-2.5 border border-dashed border-outline-variant rounded-lg text-[11px] font-label-caps text-on-surface-variant hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all"
                                >
                                    + Add Link Button
                                </button>
                            )}
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-label-caps font-label-caps text-on-surface-variant">TONE</label>
                                    <select 
                                        value={newsForm.tone}
                                        onChange={(e) => handleFieldChange("tone", e.target.value as any)}
                                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-sm focus:ring-2 focus:ring-primary/50 outline-none appearance-none"
                                    >
                                        <option value="blue">Blue</option>
                                        <option value="purple">Purple</option>
                                        <option value="teal">Teal</option>
                                        <option value="slate">Slate</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-label-caps font-label-caps text-on-surface-variant">SORT ORDER</label>
                                    <input 
                                        type="number" 
                                        value={newsForm.sortOrder}
                                        onChange={(e) => handleFieldChange("sortOrder", Number.parseInt(e.target.value) || 0)}
                                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-sm focus:ring-2 focus:ring-primary/50 outline-none" 
                                    />
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-4 pt-2 pb-2">
                                <input 
                                    id="dashboard-show" 
                                    type="checkbox" 
                                    checked={newsForm.isActive}
                                    onChange={(e) => handleFieldChange("isActive", e.target.checked)}
                                    className="w-4 h-4 rounded border-outline-variant bg-surface-container-lowest text-primary focus:ring-primary/50 cursor-pointer" 
                                />
                                <label className="text-body-sm text-on-surface select-none cursor-pointer" htmlFor="dashboard-show">
                                    Show this item on the dashboard
                                </label>
                            </div>
                            
                            <button 
                                type="submit"
                                disabled={saving || !newsForm.title.trim()}
                                className="w-full py-3 mt-6 rounded-lg text-label-caps font-bold text-white gradient-button transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saving ? "Saving..." : editingNewsId ? "Update News Item" : "Create News Item"}
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            {/* Floating Atmosphere Elements */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-[-1] overflow-hidden">
                <div className="absolute top-[10%] right-[5%] w-[400px] h-[400px] bg-primary/10 blur-[120px] rounded-full"></div>
                <div className="absolute bottom-[20%] left-[10%] w-[300px] h-[300px] bg-secondary/10 blur-[100px] rounded-full"></div>
            </div>
        </main>
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
