"use client";

import { useEffect, useState } from "react";

import AdminSubpage from "../_components/AdminSubpage";
import { api } from "../../../services/api";
import type {
    AdminCreditCodeBatchItem,
    AdminCreditCodeBatchStatusSummaryItem,
    AdminCreditCodeItem,
    AdminCreditCodeStatusSummaryItem,
} from "../../../types";

export default function AdminCodesPage() {
    const [codes, setCodes] = useState<AdminCreditCodeItem[]>([]);
    const [batches, setBatches] = useState<AdminCreditCodeBatchItem[]>([]);
    const [batchSummaries, setBatchSummaries] = useState<AdminCreditCodeBatchStatusSummaryItem[]>([]);
    const [summaries, setSummaries] = useState<AdminCreditCodeStatusSummaryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [credits, setCredits] = useState(1);
    const [maxClaims, setMaxClaims] = useState(5);
    const [creating, setCreating] = useState(false);
    const [createdCode, setCreatedCode] = useState("");
    const [createError, setCreateError] = useState("");
    const [copyState, setCopyState] = useState("");
    const [batchTitle, setBatchTitle] = useState("");
    const [batchQuantity, setBatchQuantity] = useState(5);
    const [batchCredits, setBatchCredits] = useState(5);
    const [batchCreating, setBatchCreating] = useState(false);
    const [batchMessage, setBatchMessage] = useState("");
    const [batchError, setBatchError] = useState("");
    const [showAllActiveGiftCodes, setShowAllActiveGiftCodes] = useState(false);
    const [showInactiveGiftCodes, setShowInactiveGiftCodes] = useState(false);
    const [actionMessage, setActionMessage] = useState("");
    const [actionError, setActionError] = useState("");
    const [actingTarget, setActingTarget] = useState("");

    const loadCodes = async () => {
        setLoading(true);
        setError("");
        try {
            const [codesResponse, batchResponse] = await Promise.all([
                api.getAdminCodes(),
                api.getAdminCodeBatches(),
            ]);
                const nextCodes = (codesResponse.codes ?? [])
                    .filter((item) => !item.batchId)
                    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
                const nextBatches = (batchResponse.batches ?? [])
                    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
                setCodes(nextCodes);
                setBatches(nextBatches);
                setBatchSummaries(batchResponse.summaries ?? []);
                setSummaries(codesResponse.summaries ?? []);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Unable to load codes.");
            } finally {
                setLoading(false);
            }
    };

    useEffect(() => {
        let cancelled = false;

        const loadInitialData = async () => {
            setLoading(true);
            setError("");
            try {
                const [codesResponse, batchResponse] = await Promise.all([
                    api.getAdminCodes(),
                    api.getAdminCodeBatches(),
                ]);
                if (cancelled) {
                    return;
                }
                const nextCodes = (codesResponse.codes ?? [])
                    .filter((item) => !item.batchId)
                    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
                const nextBatches = (batchResponse.batches ?? [])
                    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
                setCodes(nextCodes);
                setBatches(nextBatches);
                setBatchSummaries(batchResponse.summaries ?? []);
                setSummaries(codesResponse.summaries ?? []);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Unable to load codes.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadInitialData();

        return () => {
            cancelled = true;
        };
    }, []);

    const activeGiftCodes = codes.filter((item) => item.status === "active");
    const inactiveGiftCodes = codes.filter((item) => item.status === "inactive");
    const visibleActiveGiftCodes = showAllActiveGiftCodes ? activeGiftCodes : activeGiftCodes.slice(0, 5);
    const batchStatusSummaries = ["active", "inactive", "claimed"]
        .map((status) => batchSummaries.find((item) => item.status === status))
        .filter((item): item is AdminCreditCodeBatchStatusSummaryItem => Boolean(item));
    const compactSummaries = ["active", "inactive", "expired", "exhausted"]
        .map((status) => summaries.find((item) => item.status === status))
        .filter((item): item is AdminCreditCodeStatusSummaryItem => Boolean(item));

    const handleCreateGiftCode = async () => {
        setCreating(true);
        setCreateError("");
        setCreatedCode("");

        try {
            const boundedCredits = Math.min(5, Math.max(1, credits));
            const boundedClaims = Math.min(20, Math.max(1, maxClaims));
            const created = await api.createAdminCode(boundedCredits, boundedClaims);
            setCreatedCode(created.code || "");
            setCopyState("");
            setCredits(1);
            setMaxClaims(5);
            await loadCodes();
        } catch (err) {
            setCreateError(err instanceof Error ? err.message : "Unable to create gift code.");
        } finally {
            setCreating(false);
        }
    };

    const handleCopyCode = async () => {
        if (!createdCode) return;
        try {
            await navigator.clipboard.writeText(createdCode);
            setCopyState("Copied");
            window.setTimeout(() => setCopyState(""), 1600);
        } catch {
            setCopyState("Copy failed");
        }
    };

    const handleCreateBatchCodes = async () => {
        const normalizedTitle = batchTitle.trim();
        if (!normalizedTitle) {
            setBatchError("Title is required.");
            setBatchMessage("");
            return;
        }

        setBatchCreating(true);
        setBatchError("");
        setBatchMessage("");
        try {
            const boundedQuantity = Math.min(20, Math.max(2, batchQuantity));
            const boundedCredits = Math.min(20, Math.max(1, batchCredits));
            const response = await api.createAdminCodeBatch(boundedQuantity, boundedCredits, normalizedTitle);
            const generatedCodes = Array.isArray(response?.codes) ? response.codes : [];
            if (generatedCodes.length === 0) {
                throw new Error("No codes were generated.");
            }

            downloadCodesAsText(
                normalizedTitle,
                generatedCodes.map((item: { code?: string }) => String(item.code || "")).filter(Boolean),
            );
            setBatchMessage(`${generatedCodes.length} one-time codes downloaded.`);
            setBatchTitle("");
            setBatchQuantity(5);
            setBatchCredits(5);
            await loadCodes();
        } catch (err) {
            setBatchError(err instanceof Error ? err.message : "Unable to generate batch codes.");
        } finally {
            setBatchCreating(false);
        }
    };

    const requestReason = (label: string) => {
        const input = window.prompt(`Reason for ${label}:`, "");
        if (input === null) return null;
        const normalized = input.trim();
        if (!normalized) {
            throw new Error("Reason is required.");
        }
        return normalized;
    };

    const handleGiftCodeStatusChange = async (code: AdminCreditCodeItem, nextAction: "enable" | "disable") => {
        try {
            const reason = requestReason(`${nextAction} code ${code.codePreview}`);
            if (reason === null) return;
            setActionMessage("");
            setActionError("");
            setActingTarget(code.code);
            if (nextAction === "disable") {
                await api.disableAdminCode(code.code, reason);
            } else {
                await api.enableAdminCode(code.code, reason);
            }
            setActionMessage(`Code ${code.codePreview} ${nextAction}d.`);
            await loadCodes();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Unable to update code status.");
        } finally {
            setActingTarget("");
        }
    };

    const handleBatchStatusChange = async (batch: AdminCreditCodeBatchItem, nextAction: "enable" | "disable") => {
        try {
            const reason = requestReason(`${nextAction} batch ${batch.title}`);
            if (reason === null) return;
            setActionMessage("");
            setActionError("");
            setActingTarget(batch.batchId);
            if (nextAction === "disable") {
                await api.disableAdminCodeBatch(batch.batchId, reason);
            } else {
                await api.enableAdminCodeBatch(batch.batchId, reason);
            }
            setActionMessage(`Batch ${batch.title} ${nextAction}d.`);
            await loadCodes();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Unable to update batch status.");
        } finally {
            setActingTarget("");
        }
    };

    const generatorCardClassName = "group flex h-full flex-col rounded-2xl border border-white/8 bg-[#0f1117] p-6 transition-all duration-200 ease-in-out hover:border-violet-400/30 hover:shadow-[0_0_20px_rgba(120,80,255,0.15)]";
    const generatorInputClassName = "w-full rounded-xl border border-white/8 bg-[#1a1d2e] px-3 py-2.5 text-sm text-white outline-none transition-all duration-200 ease-in-out placeholder:text-slate-500 focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/30";
    const generatorLabelClassName = "mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500";
    const generatorButtonClassName = "inline-flex items-center justify-center rounded-xl bg-[linear-gradient(135deg,#7c3aed,#3b82f6)] px-4 py-3 text-sm font-semibold text-white transition-all duration-200 ease-in-out hover:-translate-y-[1px] hover:shadow-[0_8px_20px_rgba(124,58,237,0.4)] disabled:cursor-not-allowed disabled:opacity-60";

    return (
        <AdminSubpage title="Admin Codes" description="Create, enable, and disable controls can stay here as the codes workflow grows.">
            <section className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2 md:items-stretch animate-fade-in-up">
                <div className={generatorCardClassName}>
                    <div className="mb-6 flex items-start gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(124,58,237,0.95),rgba(59,130,246,0.95))] shadow-[0_12px_30px_rgba(124,58,237,0.25)]">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                <path d="M12 2v20" />
                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-white">Gift Code Generator</h2>
                            <p className="mt-1 text-sm text-slate-400">
                                Create one redeem code where the first <span className="text-white">{maxClaims}</span> users each receive <span className="text-white">{credits}</span> credit{credits !== 1 ? "s" : ""}.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <div>
                            <label className={generatorLabelClassName}>Credits Per User</label>
                            <input
                                type="number"
                                min={1}
                                max={5}
                                value={credits}
                                onChange={(event) => setCredits(Math.min(5, Math.max(1, Number(event.target.value) || 1)))}
                                className={generatorInputClassName}
                            />
                        </div>
                        <div>
                            <label className={generatorLabelClassName}>Max Users</label>
                            <input
                                type="number"
                                min={1}
                                max={20}
                                value={maxClaims}
                                onChange={(event) => setMaxClaims(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
                                className={generatorInputClassName}
                            />
                        </div>
                    </div>

                    <div className="mt-6">
                        <button
                            onClick={() => void handleCreateGiftCode()}
                            disabled={creating}
                            className={generatorButtonClassName}
                        >
                            <span>{creating ? "Creating..." : "Generate Code"}</span>
                        </button>
                    </div>

                    <div className="mt-6 flex-1">
                        {createdCode ? (
                            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-emerald-300">
                                    Gift Code Ready
                                </p>
                                <div className="flex items-center justify-between gap-3">
                                    <p className="break-all text-lg font-mono text-emerald-100">{createdCode}</p>
                                    <button
                                        type="button"
                                        onClick={() => void handleCopyCode()}
                                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition-all duration-200 ease-in-out hover:border-violet-300/40 hover:bg-white/10"
                                        aria-label="Copy generated code"
                                        title="Copy generated code"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                    </button>
                                </div>
                                {copyState ? (
                                    <p className={`mt-2 text-xs ${copyState === "Copied" ? "text-emerald-300" : "text-amber-300"}`}>
                                        {copyState}
                                    </p>
                                ) : null}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-white/8 bg-white/[0.02] p-4 text-sm text-slate-500">
                                Generate a gift code and it will appear here for quick copy.
                            </div>
                        )}

                        {createError ? (
                            <p className="mt-4 text-sm text-amber-300">{createError}</p>
                        ) : null}
                    </div>
                </div>

                <div className={generatorCardClassName}>
                    <div className="mb-6 flex items-start gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(124,58,237,0.95),rgba(59,130,246,0.95))] shadow-[0_12px_30px_rgba(124,58,237,0.25)]">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                <rect x="3" y="4" width="18" height="16" rx="2" />
                                <path d="M7 8h10" />
                                <path d="M7 12h10" />
                                <path d="M7 16h6" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-white">One-Time Code Batch</h2>
                            <p className="mt-1 text-sm text-slate-400">
                                Generate <span className="text-white">{batchQuantity}</span> single-use codes worth <span className="text-white">{batchCredits}</span> credit{batchCredits !== 1 ? "s" : ""} each. The codes download automatically as a text file, one code per line.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <label className={generatorLabelClassName}>Title</label>
                            <input
                                type="text"
                                value={batchTitle}
                                onChange={(event) => setBatchTitle(event.target.value)}
                                placeholder="Spring giveaway"
                                className={generatorInputClassName}
                            />
                        </div>
                        <div>
                            <label className={generatorLabelClassName}>Quantity</label>
                            <input
                                type="number"
                                min={2}
                                max={20}
                                value={batchQuantity}
                                onChange={(event) => setBatchQuantity(Math.min(20, Math.max(2, Number(event.target.value) || 2)))}
                                className={generatorInputClassName}
                            />
                        </div>
                        <div>
                            <label className={generatorLabelClassName}>Credits Per Code</label>
                            <input
                                type="number"
                                min={1}
                                max={20}
                                value={batchCredits}
                                onChange={(event) => setBatchCredits(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
                                className={generatorInputClassName}
                            />
                        </div>
                    </div>

                    <div className="mt-6 flex items-center gap-3">
                        <button
                            onClick={() => void handleCreateBatchCodes()}
                            disabled={batchCreating}
                            className={generatorButtonClassName}
                        >
                            <span>{batchCreating ? "Generating..." : "Generate And Download"}</span>
                        </button>
                    </div>

                    <div className="mt-6 flex-1">
                        <div className="rounded-2xl border border-dashed border-white/8 bg-white/[0.02] p-4 text-sm text-slate-500">
                            Each generated code is claimable only once and the export downloads automatically as plain text.
                        </div>
                        {batchMessage ? (
                            <p className="mt-4 text-sm text-emerald-300">{batchMessage}</p>
                        ) : null}
                        {batchError ? (
                            <p className="mt-4 text-sm text-amber-300">{batchError}</p>
                        ) : null}
                    </div>
                </div>
            </section>

            <section className="glass-card overflow-hidden animate-fade-in-up">
                <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-white">One-Time Code Batches</h2>
                        <p className="text-xs text-slate-500">Grouped bulk exports with claimed totals</p>
                    </div>
                    <span className="text-xs text-slate-500">{batches.length} batches</span>
                </div>
                {actionMessage ? (
                    <p className="px-5 pt-4 text-sm text-emerald-300">{actionMessage}</p>
                ) : null}
                {actionError ? (
                    <p className="px-5 pt-4 text-sm text-amber-300">{actionError}</p>
                ) : null}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="auth-loader" />
                    </div>
                ) : error ? (
                    <div className="admin-empty-state">
                        <p>{error}</p>
                    </div>
                ) : (
                    <div className="space-y-6 p-5">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            {batchStatusSummaries.map((summary) => (
                                <div key={summary.status} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                                        {formatBatchSummaryTitle(summary.status)}
                                    </p>
                                    <p className="mt-3 text-2xl font-semibold text-white">{summary.codeCount}</p>
                                    <p className="mt-1 text-xs text-slate-500">codes</p>
                                    <div className="mt-4 space-y-2 text-sm text-slate-300">
                                        <div className="flex items-center justify-between gap-4">
                                            <span>Total credits</span>
                                            <span className="text-white">{summary.totalCredits.toFixed(2)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-4">
                                            <span>Average credits</span>
                                            <span className="text-white">{summary.averageCredits.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="overflow-x-auto">
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th>Title</th>
                                        <th>Credits</th>
                                        <th>Claimed</th>
                                        <th>Status</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {batches.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-5 py-6 text-sm text-slate-400">
                                                No one-time code batches yet.
                                            </td>
                                        </tr>
                                    ) : batches.map((batch) => (
                                        <tr key={batch.batchId}>
                                            <td>
                                                <div className="admin-user-info">
                                                    <span className="admin-user-name">{batch.title}</span>
                                                    <span className="admin-user-uid">{batch.totalCodes} codes</span>
                                                </div>
                                            </td>
                                            <td><span className="admin-credits-badge admin-credits-positive">{batch.credits.toFixed(2)}</span></td>
                                            <td><span className="text-sm text-slate-300">{batch.claimedCodes} / {batch.totalCodes}</span></td>
                                            <td><span className="text-sm text-slate-300">{batch.status}</span></td>
                                            <td>
                                                {batch.status === "claimed" ? (
                                                    <span className="text-xs text-slate-500">Claimed out</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleBatchStatusChange(batch, batch.status === "inactive" ? "enable" : "disable")}
                                                        disabled={actingTarget === batch.batchId}
                                                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                                                            batch.status === "inactive"
                                                                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:border-emerald-300/50 hover:bg-emerald-400/15"
                                                                : "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:border-amber-300/50 hover:bg-amber-400/15"
                                                        }`}
                                                    >
                                                        {actingTarget === batch.batchId
                                                            ? "Saving..."
                                                            : batch.status === "inactive"
                                                                ? "Enable"
                                                                : "Disable"}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>

            <section className="glass-card overflow-hidden animate-fade-in-up mt-6">
                <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                    <div>
                        <h2 className="text-base font-semibold text-white">Gift Codes</h2>
                        <p className="text-xs text-slate-500">Active shared codes plus compact status summaries</p>
                    </div>
                    <span className="text-xs text-slate-500">{codes.length} total</span>
                </div>
                {actionMessage ? (
                    <p className="px-5 pt-4 text-sm text-emerald-300">{actionMessage}</p>
                ) : null}
                {actionError ? (
                    <p className="px-5 pt-4 text-sm text-amber-300">{actionError}</p>
                ) : null}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="auth-loader" />
                    </div>
                ) : error ? (
                    <div className="admin-empty-state">
                        <p>{error}</p>
                    </div>
                ) : (
                    <div className="space-y-6 p-5">
                        <div className="overflow-hidden rounded-2xl border border-white/8">
                            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-white">Active Gift Codes</h3>
                                    <p className="text-xs text-slate-500">Currently redeemable shared codes</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-slate-500">{activeGiftCodes.length} codes</span>
                                    {activeGiftCodes.length > 5 ? (
                                        <button
                                            type="button"
                                            onClick={() => setShowAllActiveGiftCodes((value) => !value)}
                                            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-300/50 hover:bg-emerald-400/15"
                                        >
                                            {showAllActiveGiftCodes ? "Show less" : `Show all (${activeGiftCodes.length})`}
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="admin-table">
                                    <thead>
                                            <tr>
                                                <th>Preview</th>
                                                <th>Credits</th>
                                                <th>Claims</th>
                                                <th>Status</th>
                                                <th>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {activeGiftCodes.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="px-5 py-6 text-sm text-slate-400">
                                                        No active gift codes right now.
                                                    </td>
                                                </tr>
                                            ) : visibleActiveGiftCodes.map((code) => (
                                            <tr key={code.code}>
                                                <td>
                                                    <div className="admin-user-info">
                                                        <span className="admin-user-name">{code.codePreview}</span>
                                                        <span className="admin-user-uid">{code.code}</span>
                                                    </div>
                                                </td>
                                                <td><span className="admin-credits-badge admin-credits-positive">{code.credits.toFixed(2)}</span></td>
                                                <td><span className="text-sm text-slate-300">{code.claimedCount} / {code.maxClaims}</span></td>
                                                <td><span className="text-sm text-slate-300">{code.status}</span></td>
                                                <td>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleGiftCodeStatusChange(code, "disable")}
                                                        disabled={actingTarget === code.code}
                                                        className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:border-amber-300/50 hover:bg-amber-400/15 disabled:opacity-50"
                                                    >
                                                        {actingTarget === code.code ? "Saving..." : "Disable"}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {!showAllActiveGiftCodes && activeGiftCodes.length > 5 ? (
                                <div className="border-t border-white/8 px-4 py-3 text-xs text-slate-500">
                                    Showing 5 of {activeGiftCodes.length} active gift codes.
                                </div>
                            ) : null}
                        </div>

                        <div className="overflow-hidden rounded-2xl border border-white/8">
                            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-white">Inactive Gift Codes</h3>
                                    <p className="text-xs text-slate-500">Hidden by default, available for reactivation</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-slate-500">{inactiveGiftCodes.length} codes</span>
                                    {inactiveGiftCodes.length > 0 ? (
                                        <button
                                            type="button"
                                            onClick={() => setShowInactiveGiftCodes((value) => !value)}
                                            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-300/50 hover:bg-emerald-400/15"
                                        >
                                            {showInactiveGiftCodes ? "Hide" : "Show"}
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                            {showInactiveGiftCodes && inactiveGiftCodes.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="admin-table">
                                        <thead>
                                            <tr>
                                                <th>Preview</th>
                                                <th>Credits</th>
                                                <th>Claims</th>
                                                <th>Status</th>
                                                <th>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {inactiveGiftCodes.map((code) => (
                                                <tr key={code.code}>
                                                    <td>
                                                        <div className="admin-user-info">
                                                            <span className="admin-user-name">{code.codePreview}</span>
                                                            <span className="admin-user-uid">{code.code}</span>
                                                        </div>
                                                    </td>
                                                    <td><span className="admin-credits-badge admin-credits-positive">{code.credits.toFixed(2)}</span></td>
                                                    <td><span className="text-sm text-slate-300">{code.claimedCount} / {code.maxClaims}</span></td>
                                                    <td><span className="text-sm text-slate-300">{code.status}</span></td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleGiftCodeStatusChange(code, "enable")}
                                                            disabled={actingTarget === code.code}
                                                            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-300/50 hover:bg-emerald-400/15 disabled:opacity-50"
                                                        >
                                                            {actingTarget === code.code ? "Saving..." : "Enable"}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="px-4 py-4 text-xs text-slate-500">
                                    {inactiveGiftCodes.length === 0 ? "No inactive gift codes." : "Inactive gift codes are hidden."}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            {compactSummaries.map((summary) => (
                                <div key={summary.status} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                                        {formatGiftCodeSummaryTitle(summary.status)}
                                    </p>
                                    <p className="mt-3 text-2xl font-semibold text-white">{summary.codeCount}</p>
                                    <p className="mt-1 text-xs text-slate-500">codes</p>
                                    <div className="mt-4 space-y-2 text-sm text-slate-300">
                                        <div className="flex items-center justify-between gap-4">
                                            <span>Total credits</span>
                                            <span className="text-white">{summary.totalCredits.toFixed(2)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-4">
                                            <span>Average credits</span>
                                            <span className="text-white">{summary.averageCredits.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>
        </AdminSubpage>
    );
}

function formatGiftCodeSummaryTitle(status: string) {
    if (status === "active") return "Active";
    if (status === "inactive") return "Inactive";
    if (status === "expired") return "Expired";
    if (status === "exhausted") return "Exhausted";
    return status;
}

function formatBatchSummaryTitle(status: string) {
    if (status === "active") return "Active";
    if (status === "inactive") return "Inactive";
    if (status === "claimed") return "Exhausted";
    return status;
}

function downloadCodesAsText(title: string, codes: string[]) {
    const normalizedTitle = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "codes";
    const content = codes.join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${normalizedTitle}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
