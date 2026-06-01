"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../services/api";
import type { AdminModelVisibilityResponse } from "../../../types";

type VisibleModel = AdminModelVisibilityResponse["tasks"][number]["models"][number] & {
    tasks: string[];
};

type ProviderGroup = {
    id: string;
    displayName: string;
    total: number;
    disabled: number;
    models: VisibleModel[];
};

function normalizeTaskName(value: string): string {
    return value
        .split(/[_-]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function normalizeProviderId(value: string): string {
    return value.trim().toLowerCase();
}

export default function AdminModelsPage() {
    const [data, setData] = useState<AdminModelVisibilityResponse | null>(null);
    const [disabledModelIds, setDisabledModelIds] = useState<Set<string>>(new Set());
    const [disabledProviderIds, setDisabledProviderIds] = useState<Set<string>>(new Set());
    const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError("");
            try {
                const response = await api.getAdminModelVisibility();
                if (cancelled) return;
                setData(response);
                setDisabledModelIds(new Set(response.disabledModelIds ?? []));
                setDisabledProviderIds(new Set(response.disabledProviderIds ?? []));
            } catch (loadError) {
                if (!cancelled) {
                    setError(loadError instanceof Error ? loadError.message : "Unable to load model availability.");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const dirty = useMemo(() => {
        const originalModels = new Set(data?.disabledModelIds ?? []);
        const originalProviders = new Set(data?.disabledProviderIds ?? []);
        if (originalModels.size !== disabledModelIds.size) return true;
        if (originalProviders.size !== disabledProviderIds.size) return true;
        for (const id of disabledModelIds) {
            if (!originalModels.has(id)) return true;
        }
        for (const id of disabledProviderIds) {
            if (!originalProviders.has(id)) return true;
        }
        return false;
    }, [data, disabledModelIds, disabledProviderIds]);

    const providerGroups = useMemo(() => {
        const term = query.trim().toLowerCase();
        const providerMeta = new Map(
            (data?.providers ?? []).map((provider) => [provider.id, provider]),
        );
        const groups = new Map<string, ProviderGroup>();

        for (const task of data?.tasks ?? []) {
            for (const model of task.models) {
                const providerId = normalizeProviderId(model.provider || "unknown");
                const searchable = [
                    model.id,
                    model.displayName,
                    model.provider,
                    model.description,
                    task.task,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                if (term && !searchable.includes(term)) continue;

                const meta = providerMeta.get(providerId);
                const group = groups.get(providerId) ?? {
                    id: providerId,
                    displayName: meta?.displayName || model.provider || providerId,
                    total: meta?.total ?? 0,
                    disabled: meta?.disabled ?? 0,
                    models: [],
                };
                const existing = group.models.find((item) => item.id === model.id);
                if (existing) {
                    if (!existing.tasks.includes(task.task)) {
                        existing.tasks.push(task.task);
                    }
                } else {
                    group.models.push({ ...model, tasks: [task.task] });
                }
                groups.set(providerId, group);
            }
        }

        return Array.from(groups.values())
            .map((group) => ({
                ...group,
                models: group.models.sort((a, b) =>
                    String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)),
                ),
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
    }, [data, query]);

    const toggleModel = (modelId: string) => {
        setNotice("");
        setDisabledModelIds((current) => {
            const next = new Set(current);
            if (next.has(modelId)) {
                next.delete(modelId);
            } else {
                next.add(modelId);
            }
            return next;
        });
    };

    const toggleProvider = (providerId: string) => {
        setNotice("");
        setDisabledProviderIds((current) => {
            const next = new Set(current);
            if (next.has(providerId)) {
                next.delete(providerId);
            } else {
                next.add(providerId);
            }
            return next;
        });
    };

    const toggleProviderExpansion = (providerId: string) => {
        setExpandedProviders((current) => {
            const next = new Set(current);
            if (next.has(providerId)) {
                next.delete(providerId);
            } else {
                next.add(providerId);
            }
            return next;
        });
    };

    const save = async () => {
        setSaving(true);
        setError("");
        setNotice("");
        try {
            const response = await api.updateAdminModelVisibility(
                Array.from(disabledModelIds).sort(),
                Array.from(disabledProviderIds).sort(),
            );
            setData(response);
            setDisabledModelIds(new Set(response.disabledModelIds ?? []));
            setDisabledProviderIds(new Set(response.disabledProviderIds ?? []));
            setNotice("Model availability updated successfully.");
            
            // clear notice after 3s
            setTimeout(() => setNotice(""), 3000);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Unable to update model availability.");
        } finally {
            setSaving(false);
        }
    };

    if (loading && providerGroups.length === 0) {
        return (
            <main className="flex-1 overflow-y-auto p-8 h-[calc(100vh-64px)] flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    return (
        <main className="flex-1 overflow-y-auto p-0 h-[calc(100vh-64px)] custom-scrollbar relative flex flex-col">
            <div className="flex-1 p-6 lg:p-8 max-w-[1440px] mx-auto w-full">
                {/* Hero Description */}
                <div className="mb-8">
                    <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2 font-bold tracking-tight">Model Availability</h1>
                    <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
                        Control which catalog providers and models users can choose. Ensure optimal performance by managing the operational availability of generative assets across your cluster.
                    </p>
                </div>

                {error && (
                    <div className="p-4 rounded-lg border border-error-container/30 bg-error-container/10 text-error mb-8">
                        {error}
                    </div>
                )}
                {notice && (
                    <div className="p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 mb-8">
                        {notice}
                    </div>
                )}

                {/* Stats Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <div className="glass-panel p-4 rounded-lg border-l-4 border-l-outline border border-outline-variant/50">
                        <span className="font-label-caps text-label-caps text-outline uppercase tracking-widest">Total</span>
                        <div className="font-headline-lg text-[32px] font-bold text-on-surface mt-2">{data?.total ?? 0}</div>
                    </div>
                    <div className="glass-panel p-4 rounded-lg border-l-4 border-l-tertiary bg-tertiary-container/10 border border-outline-variant/50">
                        <span className="font-label-caps text-label-caps text-tertiary-fixed uppercase tracking-widest">Enabled</span>
                        <div className="font-headline-lg text-[32px] font-bold mt-2 text-tertiary">{data?.enabled ?? 0}</div>
                    </div>
                    <div className="glass-panel p-4 rounded-lg border-l-4 border-l-error bg-error-container/10 border border-outline-variant/50">
                        <span className="font-label-caps text-label-caps text-error uppercase tracking-widest">Disabled</span>
                        <div className="font-headline-lg text-[32px] font-bold text-error mt-2">{data?.disabled ?? 0}</div>
                    </div>
                    <div className="glass-panel p-4 rounded-lg border-l-4 border-l-secondary-container bg-secondary-container/10 border border-outline-variant/50">
                        <span className="font-label-caps text-label-caps text-secondary uppercase tracking-widest">Providers Off</span>
                        <div className="font-headline-lg text-[32px] font-bold text-secondary mt-2">{disabledProviderIds.size}</div>
                    </div>
                </div>

                {/* Search & Global Action */}
                <div className="flex flex-wrap items-center gap-6 mb-8 bg-surface-container-high/40 p-6 rounded-lg border border-outline-variant/50">
                    <div className="relative flex-1 min-w-[300px]">
                        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-[20px]">search</span>
                        <input 
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg pl-12 pr-4 py-3 font-body-lg text-body-sm focus:ring-2 focus:ring-primary/50 focus:border-transparent outline-none transition-all" 
                            placeholder="Search providers or models" 
                            type="text" 
                        />
                    </div>
                </div>

                {/* Provider Groups */}
                <div className="space-y-8 pb-10">
                    {providerGroups.length === 0 ? (
                        <div className="glass-panel p-8 text-center text-sm text-slate-400 rounded-lg italic">No models match this search.</div>
                    ) : (
                        providerGroups.map((provider) => {
                            const providerDisabled = disabledProviderIds.has(provider.id);
                            const expanded = expandedProviders.has(provider.id);
                            const visibleModels = expanded ? provider.models : provider.models.slice(0, 3);
                            
                            return (
                                <section key={provider.id} className="glass-panel rounded-2xl overflow-hidden border border-outline-variant/40 hover:border-primary/30 transition-colors group">
                                    <div className="p-6 bg-surface-container-highest/30 flex flex-col sm:flex-row sm:items-center justify-between border-b border-outline-variant/50 gap-4">
                                        <div className="flex items-center gap-6">
                                            <h2 className="font-title-md text-title-md font-bold text-on-surface">{provider.displayName}</h2>
                                            {providerDisabled ? (
                                                <span className="bg-error-container/20 text-error px-3 py-1 rounded-full text-[10px] font-bold border border-error/30 uppercase tracking-widest">Provider disabled</span>
                                            ) : (
                                                <span className="bg-tertiary-container/20 text-tertiary-fixed px-3 py-1 rounded-full text-[10px] font-bold border border-tertiary/30 uppercase tracking-widest">Provider enabled</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="font-code-sm text-[12px] text-outline hidden sm:inline-block">{provider.models.length} matching models • {provider.disabled} disabled</span>
                                            <button 
                                                onClick={() => toggleProvider(provider.id)}
                                                className={`px-4 py-1.5 rounded-lg border transition-colors font-body-sm text-[13px] font-bold ${providerDisabled ? 'border-tertiary/50 text-tertiary hover:bg-tertiary-container/20' : 'border-error/50 text-error hover:bg-error-container/20'}`}
                                            >
                                                {providerDisabled ? "Enable provider" : "Disable provider"}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="divide-y divide-outline-variant/30">
                                        {visibleModels.map((model) => {
                                            const modelDisabled = disabledModelIds.has(model.id);
                                            const disabled = modelDisabled || providerDisabled;
                                            
                                            return (
                                                <div key={model.id} className={`p-6 flex items-start gap-6 transition-colors ${disabled ? 'bg-surface-container-lowest/50 opacity-70' : 'hover:bg-surface-variant/20'}`}>
                                                    <div className="pt-1">
                                                        <label className="relative inline-flex items-center cursor-pointer group">
                                                            <input 
                                                                type="checkbox" 
                                                                className="sr-only peer"
                                                                checked={!modelDisabled}
                                                                disabled={providerDisabled}
                                                                onChange={() => toggleModel(model.id)}
                                                            />
                                                            <div className="w-11 h-6 bg-surface-variant rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/30 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary opacity-90 peer-disabled:opacity-40"></div>
                                                        </label>
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-4 mb-1">
                                                            <h3 className="font-title-md text-[18px] font-bold text-on-surface">{model.displayName || model.id}</h3>
                                                            {providerDisabled ? (
                                                                <span className="bg-error/10 text-error px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-error/20">Provider Disabled</span>
                                                            ) : modelDisabled ? (
                                                                <span className="bg-error/20 text-error px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">Disabled</span>
                                                            ) : (
                                                                <span className="bg-tertiary/20 text-tertiary px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-tertiary/30">Enabled</span>
                                                            )}
                                                        </div>
                                                        <p className="font-code-sm text-[12px] text-outline mb-2">{model.id}</p>
                                                        {model.description && (
                                                            <p className="font-body-sm text-[13px] text-on-surface-variant mb-3">{model.description}</p>
                                                        )}
                                                        <div className="flex flex-wrap gap-6 mt-2">
                                                            <span className="font-label-caps text-[10px] text-outline uppercase tracking-widest"><span className="text-primary mr-1 opacity-60">Tasks:</span> {model.tasks.map(normalizeTaskName).join(", ")}</span>
                                                            <span className="font-label-caps text-[10px] text-outline uppercase tracking-widest"><span className="text-primary mr-1 opacity-60">Input:</span> {model.inputModalities.join(", ") || "unknown"}</span>
                                                            <span className="font-label-caps text-[10px] text-outline uppercase tracking-widest"><span className="text-primary mr-1 opacity-60">Output:</span> {model.outputModalities.join(", ") || "unknown"}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    
                                    {provider.models.length > 3 && (
                                        <button 
                                            onClick={() => toggleProviderExpansion(provider.id)}
                                            className="w-full py-3 text-center font-label-caps text-[11px] font-bold tracking-widest text-primary bg-surface-container-highest/20 hover:bg-surface-container-highest/40 transition-colors border-t border-outline-variant/30 uppercase"
                                        >
                                            {expanded ? "Show fewer models" : `Show all ${provider.models.length} models`}
                                        </button>
                                    )}
                                </section>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Sticky Save Button */}
            <div className="sticky bottom-0 left-0 right-0 bg-surface-container/90 backdrop-blur-md border-t border-outline-variant p-6 flex justify-end z-40">
                <div className="max-w-[1440px] w-full mx-auto flex justify-end items-center gap-4">
                    {dirty && <span className="text-[13px] text-amber-300 font-bold animate-pulse hidden sm:inline-block">Unsaved changes</span>}
                    <button 
                        onClick={save}
                        disabled={!dirty || saving || loading}
                        className="bg-primary text-on-primary font-bold px-12 py-3 rounded-lg hover:scale-[1.02] active:scale-95 transition-transform shadow-lg shadow-primary/20 disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
                    >
                        {saving ? "Saving..." : "Save Changes"}
                    </button>
                </div>
            </div>
        </main>
    );
}
