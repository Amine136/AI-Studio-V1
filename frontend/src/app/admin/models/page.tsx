"use client";

import { useEffect, useMemo, useState } from "react";

import AdminSubpage from "../_components/AdminSubpage";
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
            setNotice("Model availability updated.");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Unable to update model availability.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminSubpage title="Model Availability" description="Control which catalog providers and models users can choose">
            <section className="glass-card p-4 sm:p-5 animate-fade-in-up">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="grid grid-cols-4 gap-3 text-sm sm:min-w-[460px]">
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
                            <p className="mt-1 text-xl font-semibold text-white">{data?.total ?? 0}</p>
                        </div>
                        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3">
                            <p className="text-xs uppercase tracking-wide text-emerald-200/80">Enabled</p>
                            <p className="mt-1 text-xl font-semibold text-emerald-100">{data?.enabled ?? 0}</p>
                        </div>
                        <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
                            <p className="text-xs uppercase tracking-wide text-amber-200/80">Disabled</p>
                            <p className="mt-1 text-xl font-semibold text-amber-100">{data?.disabled ?? 0}</p>
                        </div>
                        <div className="rounded-xl border border-violet-400/20 bg-violet-400/10 p-3">
                            <p className="text-xs uppercase tracking-wide text-violet-200/80">Providers Off</p>
                            <p className="mt-1 text-xl font-semibold text-violet-100">{disabledProviderIds.size}</p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search providers or models"
                            className="min-w-[240px] rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white outline-none transition focus:border-violet-400/60"
                        />
                        <button
                            onClick={save}
                            disabled={!dirty || saving || loading}
                            className="btn-primary px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <span>{saving ? "Saving..." : "Save"}</span>
                        </button>
                    </div>
                </div>

                {error ? <p className="mt-4 text-sm text-amber-300">{error}</p> : null}
                {notice ? <p className="mt-4 text-sm text-emerald-300">{notice}</p> : null}
            </section>

            <section className="mt-6 space-y-5 animate-fade-in-up" style={{ animationDelay: "80ms" }}>
                {loading ? (
                    <div className="glass-card flex items-center justify-center py-20">
                        <div className="auth-loader" />
                    </div>
                ) : providerGroups.length === 0 ? (
                    <div className="glass-card p-8 text-center text-sm text-slate-400">No models match this search.</div>
                ) : (
                    providerGroups.map((provider) => {
                        const providerDisabled = disabledProviderIds.has(provider.id);
                        const expanded = expandedProviders.has(provider.id);
                        const visibleModels = expanded ? provider.models : provider.models.slice(0, 3);
                        return (
                            <div key={provider.id} className="glass-card overflow-hidden">
                                <div className="flex flex-col gap-3 border-b border-white/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <h2 className="text-base font-semibold text-white">{provider.displayName}</h2>
                                            <button
                                                type="button"
                                                onClick={() => toggleProvider(provider.id)}
                                                className={providerDisabled ? "rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/15" : "rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/15"}
                                            >
                                                {providerDisabled ? "Enable provider" : "Disable provider"}
                                            </button>
                                            <span className={providerDisabled ? "rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200" : "rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200"}>
                                                {providerDisabled ? "Provider disabled" : "Provider enabled"}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">{provider.models.length} matching models · {provider.disabled} disabled</p>
                                    </div>
                                </div>

                                <div className="divide-y divide-white/6">
                                    {visibleModels.map((model) => {
                                        const modelDisabled = disabledModelIds.has(model.id);
                                        const disabled = modelDisabled || providerDisabled;
                                        return (
                                            <label key={`${provider.id}:${model.id}`} className="flex cursor-pointer items-start gap-4 px-5 py-4 transition hover:bg-white/[0.03]">
                                                <input
                                                    type="checkbox"
                                                    checked={!modelDisabled}
                                                    disabled={providerDisabled}
                                                    onChange={() => toggleModel(model.id)}
                                                    className="mt-1 h-4 w-4 rounded border-white/20 bg-white/10 accent-violet-500 disabled:opacity-40"
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-medium text-slate-100">{model.displayName || model.id}</span>
                                                        <span className={disabled ? "rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200" : "rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200"}>
                                                            {providerDisabled ? "Provider disabled" : modelDisabled ? "Disabled" : "Enabled"}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 break-all text-xs text-slate-500">{model.id}</p>
                                                    {model.description ? <p className="mt-2 text-sm text-slate-400">{model.description}</p> : null}
                                                    <p className="mt-2 text-xs text-slate-500">
                                                        Tasks: {model.tasks.map(normalizeTaskName).join(", ")} · Input: {model.inputModalities.join(", ") || "unknown"} · Output: {model.outputModalities.join(", ") || "unknown"}
                                                    </p>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>

                                {provider.models.length > 3 ? (
                                    <div className="border-t border-white/8 px-5 py-3">
                                        <button
                                            type="button"
                                            onClick={() => toggleProviderExpansion(provider.id)}
                                            className="text-sm font-medium text-violet-200 transition hover:text-white"
                                        >
                                            {expanded ? "Show only 3 models" : `Show all ${provider.models.length} models`}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })
                )}
            </section>
        </AdminSubpage>
    );
}
