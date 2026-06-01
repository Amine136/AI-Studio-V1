"use client";

import { useEffect, useState } from "react";
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

    const getBatchSummary = (status: string) => batchStatusSummaries.find(s => s.status === status) || { codeCount: 0, totalCredits: 0, averageCredits: 0 };
    const getCodeSummary = (status: string) => compactSummaries.find(s => s.status === status) || { codeCount: 0, totalCredits: 0, averageCredits: 0 };

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
            window.alert("Reason is required.");
            return null;
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

    if (loading && codes.length === 0) {
        return (
            <main className="flex-1 overflow-y-auto p-6 min-h-[calc(100vh-4rem)] flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    if (error && codes.length === 0) {
        return (
            <main className="flex-1 overflow-y-auto p-6 min-h-[calc(100vh-4rem)] flex items-center justify-center">
                <p className="text-error">{error}</p>
            </main>
        );
    }

    return (
        <main className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar relative">
            <div className="max-w-[1440px] mx-auto space-y-8">
                {/* Header Section */}
                <section className="flex flex-col gap-2">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-secondary-container flex items-center justify-center">
                            <span className="material-symbols-outlined text-on-primary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>terminal</span>
                        </div>
                        <div>
                            <h2 className="font-headline-lg text-headline-lg text-on-surface">Admin Codes</h2>
                            <p className="font-body-lg text-body-lg text-on-surface-variant">Create, enable, and disable controls as your codes workflow grows.</p>
                        </div>
                    </div>
                </section>

                {(actionMessage || actionError) && (
                    <div className={`p-4 rounded-lg border ${actionError ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
                        {actionError || actionMessage}
                    </div>
                )}

                {/* Generation Section (Top Row) */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Gift Code Generator */}
                    <div className="glass-panel rounded-lg p-6 flex flex-col gap-6">
                        <div className="flex items-start gap-6">
                            <div className="w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center text-primary">
                                <span className="material-symbols-outlined">attach_money</span>
                            </div>
                            <div>
                                <h3 className="font-title-md text-title-md text-on-surface">Gift Code Generator</h3>
                                <p className="text-body-sm text-on-surface-variant">Create one redeem code where the first {maxClaims} users receive {credits} credit{credits !== 1 ? "s" : ""}.</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="flex flex-col gap-2">
                                <label className="font-label-caps text-label-caps text-on-surface-variant">CREDITS PER USER</label>
                                <input 
                                    className="bg-surface-container-lowest border border-outline-variant rounded-lg p-6 text-on-surface focus:border-primary focus:ring-0 outline-none transition-all" 
                                    type="number" 
                                    min={1} max={5}
                                    value={credits}
                                    onChange={(e) => setCredits(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="font-label-caps text-label-caps text-on-surface-variant">MAX USERS</label>
                                <input 
                                    className="bg-surface-container-lowest border border-outline-variant rounded-lg p-6 text-on-surface focus:border-primary focus:ring-0 outline-none transition-all" 
                                    type="number" 
                                    min={1} max={20}
                                    value={maxClaims}
                                    onChange={(e) => setMaxClaims(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                                />
                            </div>
                        </div>
                        <button 
                            disabled={creating}
                            onClick={() => void handleCreateGiftCode()}
                            className="w-fit px-8 py-4 bg-gradient-to-r from-primary-container to-secondary-container text-white font-bold rounded-lg shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-60"
                        >
                            {creating ? "Creating..." : "Generate Code"}
                        </button>
                        
                        <div className={`mt-2 rounded-lg p-6 flex items-center justify-between gap-3 ${createdCode ? 'border border-emerald-400/20 bg-emerald-400/10' : 'border-2 border-dashed border-outline-variant justify-center'}`}>
                            {createdCode ? (
                                <>
                                    <p className="break-all text-lg font-mono text-emerald-300 font-bold">{createdCode}</p>
                                    <div className="flex items-center gap-3">
                                        {copyState && <span className="text-xs text-emerald-400">{copyState}</span>}
                                        <button onClick={() => void handleCopyCode()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-all">
                                            <span className="material-symbols-outlined text-[18px]">content_copy</span>
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <p className="text-body-sm text-outline italic">Generate a gift code and it will appear here for quick copy.</p>
                            )}
                        </div>
                        {createError && <p className="text-sm text-amber-300">{createError}</p>}
                    </div>

                    {/* One-Time Code Batch */}
                    <div className="glass-panel rounded-lg p-6 flex flex-col gap-6">
                        <div className="flex items-start gap-6">
                            <div className="w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center text-tertiary">
                                <span className="material-symbols-outlined">article</span>
                            </div>
                            <div>
                                <h3 className="font-title-md text-title-md text-on-surface">One-Time Code Batch</h3>
                                <p className="text-body-sm text-on-surface-variant">Generate multiple single-use codes and download automatically.</p>
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="font-label-caps text-label-caps text-on-surface-variant">BATCH TITLE</label>
                            <input 
                                className="bg-surface-container-lowest border border-outline-variant rounded-lg p-6 text-on-surface focus:border-tertiary focus:ring-0 outline-none transition-all" 
                                placeholder="Spring giveaway" 
                                type="text" 
                                value={batchTitle}
                                onChange={(e) => setBatchTitle(e.target.value)}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="flex flex-col gap-2">
                                <label className="font-label-caps text-label-caps text-on-surface-variant">QUANTITY</label>
                                <input 
                                    className="bg-surface-container-lowest border border-outline-variant rounded-lg p-6 text-on-surface focus:border-tertiary focus:ring-0 outline-none transition-all" 
                                    type="number" 
                                    min={2} max={20}
                                    value={batchQuantity}
                                    onChange={(e) => setBatchQuantity(Math.min(20, Math.max(2, Number(e.target.value) || 2)))}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="font-label-caps text-label-caps text-on-surface-variant">CREDITS PER CODE</label>
                                <input 
                                    className="bg-surface-container-lowest border border-outline-variant rounded-lg p-6 text-on-surface focus:border-tertiary focus:ring-0 outline-none transition-all" 
                                    type="number" 
                                    min={1} max={20}
                                    value={batchCredits}
                                    onChange={(e) => setBatchCredits(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                                />
                            </div>
                        </div>
                        <button 
                            disabled={batchCreating}
                            onClick={() => void handleCreateBatchCodes()}
                            className="w-fit px-8 py-4 bg-gradient-to-r from-tertiary-container to-tertiary text-on-tertiary font-bold rounded-lg shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-60"
                        >
                            {batchCreating ? "Generating..." : "Generate And Download"}
                        </button>
                        <div className="bg-surface-container-low/50 rounded-lg p-4 flex items-center justify-between">
                            <p className="text-[11px] text-on-surface-variant flex items-center gap-2">
                                <span className="material-symbols-outlined text-[14px]">info</span>
                                Each generated code is claimable only once and downloads as plain text.
                            </p>
                        </div>
                        {batchMessage && <p className="text-sm text-emerald-300">{batchMessage}</p>}
                        {batchError && <p className="text-sm text-amber-300">{batchError}</p>}
                    </div>
                </section>

                {/* Middle Section: One-Time Code Batches */}
                <section className="glass-panel rounded-lg overflow-hidden">
                    <div className="p-6 border-b border-outline-variant flex justify-between items-end">
                        <div>
                            <h3 className="font-title-md text-title-md text-on-surface">One-Time Code Batches</h3>
                            <p className="text-body-sm text-on-surface-variant">Grouped bulk exports with claimed totals</p>
                        </div>
                        <p className="font-label-caps text-[11px] text-on-surface-variant">{batches.length} batches</p>
                    </div>
                    <div className="p-6 space-y-8">
                        {/* Summary Metrics */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-surface-container-high rounded-lg p-6 border border-outline-variant">
                                <p className="font-label-caps text-[10px] text-primary mb-2">ACTIVE</p>
                                <h4 className="text-[28px] font-bold text-on-surface">{getBatchSummary('active').codeCount} <span className="text-body-sm text-on-surface-variant font-normal">codes</span></h4>
                                <div className="mt-6 space-y-2 pt-2 border-t border-outline-variant">
                                    <div className="flex justify-between text-[11px]"><span className="text-on-surface-variant">Total credits</span><span className="">{getBatchSummary('active').totalCredits.toFixed(2)}</span></div>
                                    <div className="flex justify-between text-[11px]"><span className="text-on-surface-variant">Average credits</span><span className="">{getBatchSummary('active').averageCredits.toFixed(2)}</span></div>
                                </div>
                            </div>
                            <div className="bg-surface-container-high rounded-lg p-6 border border-outline-variant">
                                <p className="font-label-caps text-[10px] text-on-surface-variant mb-2">INACTIVE</p>
                                <h4 className="text-[28px] font-bold text-on-surface">{getBatchSummary('inactive').codeCount} <span className="text-body-sm text-on-surface-variant font-normal">codes</span></h4>
                                <div className="mt-6 space-y-2 pt-2 border-t border-outline-variant">
                                    <div className="flex justify-between text-[11px]"><span className="text-on-surface-variant">Total credits</span><span className="">{getBatchSummary('inactive').totalCredits.toFixed(2)}</span></div>
                                    <div className="flex justify-between text-[11px]"><span className="text-on-surface-variant">Average credits</span><span className="">{getBatchSummary('inactive').averageCredits.toFixed(2)}</span></div>
                                </div>
                            </div>
                            <div className="bg-surface-container-high rounded-lg p-6 border border-outline-variant">
                                <p className="font-label-caps text-[10px] text-error mb-2">EXHAUSTED</p>
                                <h4 className="text-[28px] font-bold text-on-surface">{getBatchSummary('claimed').codeCount} <span className="text-body-sm text-on-surface-variant font-normal">codes</span></h4>
                                <div className="mt-6 space-y-2 pt-2 border-t border-outline-variant">
                                    <div className="flex justify-between text-[11px]"><span className="text-on-surface-variant">Total credits</span><span className="">{getBatchSummary('claimed').totalCredits.toFixed(2)}</span></div>
                                    <div className="flex justify-between text-[11px]"><span className="text-on-surface-variant">Average credits</span><span className="">{getBatchSummary('claimed').averageCredits.toFixed(2)}</span></div>
                                </div>
                            </div>
                        </div>

                        {/* Table Content */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="font-label-caps text-label-caps text-on-surface-variant">
                                        <th className="pb-6">TITLE</th>
                                        <th className="pb-6">CREDITS</th>
                                        <th className="pb-6">CLAIMED</th>
                                        <th className="pb-6">STATUS</th>
                                        <th className="pb-6">ACTION</th>
                                    </tr>
                                </thead>
                                <tbody className="text-body-sm divide-y divide-outline-variant">
                                    {batches.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="py-6 text-center text-on-surface-variant">No one-time code batches yet.</td>
                                        </tr>
                                    )}
                                    {batches.map((batch) => (
                                        <tr key={batch.batchId} className="hover:bg-surface-container-highest/30 transition-colors">
                                            <td className="py-6 pr-4">
                                                <p className="font-bold text-on-surface">{batch.title}</p>
                                                <p className="text-[11px] text-on-surface-variant">{batch.totalCodes} codes</p>
                                            </td>
                                            <td className="py-6 pr-4">
                                                <span className="px-6 py-1 rounded-full bg-tertiary/10 text-tertiary border border-tertiary/20">{batch.credits.toFixed(2)}</span>
                                            </td>
                                            <td className="py-6 text-on-surface pr-4">{batch.claimedCodes} / {batch.totalCodes}</td>
                                            <td className="py-6 pr-4">
                                                {batch.status === "active" ? (
                                                    <span className="flex items-center gap-2 text-primary">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-primary glow-primary"></span>
                                                        active
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-2 text-on-surface-variant">
                                                        {batch.status}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-6">
                                                {batch.status === "claimed" ? (
                                                    <span className="text-[11px] text-on-surface-variant italic">Claimed out</span>
                                                ) : (
                                                    <button 
                                                        onClick={() => void handleBatchStatusChange(batch, batch.status === "inactive" ? "enable" : "disable")}
                                                        disabled={actingTarget === batch.batchId}
                                                        className={`px-6 py-1 border rounded-full text-[11px] transition-all disabled:opacity-50 ${batch.status === "inactive" ? 'border-tertiary text-tertiary hover:bg-tertiary/10' : 'border-secondary text-secondary hover:bg-secondary/10'}`}
                                                    >
                                                        {actingTarget === batch.batchId ? "Saving..." : batch.status === "inactive" ? "Enable" : "Disable"}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                {/* Bottom Section: Gift Codes Management */}
                <section className="glass-panel rounded-lg overflow-hidden pb-4">
                    <div className="p-6 border-b border-outline-variant flex justify-between items-end">
                        <div>
                            <h3 className="font-title-md text-title-md text-on-surface">Gift Codes</h3>
                            <p className="text-body-sm text-on-surface-variant">Active shared codes plus compact status summaries</p>
                        </div>
                        <p className="font-label-caps text-[11px] text-on-surface-variant">{codes.length} total</p>
                    </div>
                    <div className="p-6 space-y-8">
                        {/* Active Gift Codes Container */}
                        <div className="bg-surface-container-low border border-outline-variant rounded-lg overflow-hidden">
                            <div className="p-6 bg-surface-container-high/50 flex justify-between items-center">
                                <div>
                                    <p className="font-title-md text-on-surface text-[16px] font-bold leading-none mb-1">Active Gift Codes</p>
                                    <p className="text-[11px] text-on-surface-variant">Currently redeemable shared codes</p>
                                </div>
                                <div className="flex items-center gap-6">
                                    <span className="text-[11px] text-on-surface-variant">{activeGiftCodes.length} codes</span>
                                    {activeGiftCodes.length > 5 && (
                                        <button 
                                            onClick={() => setShowAllActiveGiftCodes(!showAllActiveGiftCodes)}
                                            className="px-6 py-1.5 bg-tertiary/10 text-tertiary border border-tertiary/20 rounded-lg text-[11px] font-bold hover:bg-tertiary hover:text-on-tertiary transition-all"
                                        >
                                            {showAllActiveGiftCodes ? "Show less" : `Show all (${activeGiftCodes.length})`}
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="p-6">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="font-label-caps text-[10px] text-on-surface-variant tracking-widest border-b border-outline-variant">
                                                <th className="pb-6">PREVIEW</th>
                                                <th className="pb-6">CREDITS</th>
                                                <th className="pb-6">CLAIMS</th>
                                                <th className="pb-6">STATUS</th>
                                                <th className="pb-6">ACTION</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-body-sm">
                                            {activeGiftCodes.length === 0 && (
                                                <tr><td colSpan={5} className="py-4 text-sm text-on-surface-variant">No active gift codes right now.</td></tr>
                                            )}
                                            {visibleActiveGiftCodes.map(code => (
                                                <tr key={code.code} className="border-b border-outline-variant/50 hover:bg-surface-container-highest/20 transition-colors last:border-0">
                                                    <td className="py-6 pr-4">
                                                        <p className="font-bold text-on-surface font-code-sm">{code.codePreview}</p>
                                                        <p className="text-[9px] text-on-surface-variant font-code-sm truncate max-w-[200px]">{code.code}</p>
                                                    </td>
                                                    <td className="py-6 pr-4">
                                                        <span className="px-6 py-1 rounded-lg bg-tertiary/10 text-tertiary text-[11px] font-bold">{code.credits.toFixed(2)}</span>
                                                    </td>
                                                    <td className="py-6 text-on-surface pr-4">{code.claimedCount} / {code.maxClaims}</td>
                                                    <td className="py-6 text-primary pr-4">active</td>
                                                    <td className="py-6">
                                                        <button 
                                                            onClick={() => void handleGiftCodeStatusChange(code, "disable")}
                                                            disabled={actingTarget === code.code}
                                                            className="px-6 py-1 border border-secondary text-secondary rounded-lg text-[10px] hover:bg-secondary/10 transition-all disabled:opacity-50"
                                                        >
                                                            {actingTarget === code.code ? "Saving..." : "Disable"}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {!showAllActiveGiftCodes && activeGiftCodes.length > 5 && (
                                    <div className="mt-6">
                                        <p className="text-[10px] text-on-surface-variant italic">Showing 5 of {activeGiftCodes.length} active gift codes.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Inactive Gift Codes Section */}
                        <div className="bg-surface-container-low/30 border border-outline-variant/50 rounded-lg p-6">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <p className="text-on-surface font-bold text-[16px]">Inactive Gift Codes</p>
                                    <p className="text-[11px] text-on-surface-variant">Hidden by default, available for reactivation</p>
                                </div>
                                <div className="flex items-center gap-6">
                                    <span className="text-[11px] text-on-surface-variant">{inactiveGiftCodes.length} codes</span>
                                    {inactiveGiftCodes.length > 0 && (
                                        <button 
                                            onClick={() => setShowInactiveGiftCodes(!showInactiveGiftCodes)}
                                            className="px-6 py-1.5 border border-outline text-on-surface-variant rounded-lg text-[11px] hover:bg-surface-container-highest transition-all"
                                        >
                                            {showInactiveGiftCodes ? "Hide" : "Show"}
                                        </button>
                                    )}
                                </div>
                            </div>
                            
                            {showInactiveGiftCodes ? (
                                <div className="overflow-x-auto mt-4">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="font-label-caps text-[10px] text-on-surface-variant tracking-widest border-b border-outline-variant/50">
                                                <th className="pb-6">PREVIEW</th>
                                                <th className="pb-6">CREDITS</th>
                                                <th className="pb-6">CLAIMS</th>
                                                <th className="pb-6">STATUS</th>
                                                <th className="pb-6">ACTION</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-body-sm">
                                            {inactiveGiftCodes.map(code => (
                                                <tr key={code.code} className="border-b border-outline-variant/50 hover:bg-surface-container-highest/20 transition-colors last:border-0">
                                                    <td className="py-6 pr-4">
                                                        <p className="font-bold text-on-surface font-code-sm">{code.codePreview}</p>
                                                        <p className="text-[9px] text-on-surface-variant font-code-sm truncate max-w-[200px]">{code.code}</p>
                                                    </td>
                                                    <td className="py-6 pr-4">
                                                        <span className="px-6 py-1 rounded-lg bg-tertiary/10 text-tertiary text-[11px] font-bold">{code.credits.toFixed(2)}</span>
                                                    </td>
                                                    <td className="py-6 text-on-surface pr-4">{code.claimedCount} / {code.maxClaims}</td>
                                                    <td className="py-6 text-on-surface-variant pr-4">inactive</td>
                                                    <td className="py-6">
                                                        <button 
                                                            onClick={() => void handleGiftCodeStatusChange(code, "enable")}
                                                            disabled={actingTarget === code.code}
                                                            className="px-6 py-1 border border-tertiary text-tertiary rounded-lg text-[10px] hover:bg-tertiary/10 transition-all disabled:opacity-50"
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
                                <p className="text-[12px] text-outline italic">Inactive gift codes are hidden.</p>
                            )}
                        </div>

                        {/* Inactive Codes Summary Metrics */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-6">
                            <div className="bg-surface-container-high/40 rounded-lg p-6 border border-outline-variant">
                                <p className="font-label-caps text-[10px] text-primary mb-2">ACTIVE</p>
                                <h4 className="text-[28px] font-bold text-on-surface">{getCodeSummary('active').codeCount} <span className="text-body-sm text-on-surface-variant font-normal">codes</span></h4>
                                <div className="mt-6 space-y-2 pt-2 border-t border-outline-variant/30">
                                    <div className="flex justify-between text-[11px] font-code-sm"><span className="text-on-surface-variant">Total credits</span><span className="">{getCodeSummary('active').totalCredits.toFixed(2)}</span></div>
                                    <div className="flex justify-between text-[11px] font-code-sm"><span className="text-on-surface-variant">Average credits</span><span className="">{getCodeSummary('active').averageCredits.toFixed(2)}</span></div>
                                </div>
                            </div>
                            <div className="bg-surface-container-high/40 rounded-lg p-6 border border-outline-variant">
                                <p className="font-label-caps text-[10px] text-on-surface-variant mb-2">INACTIVE</p>
                                <h4 className="text-[28px] font-bold text-on-surface">{getCodeSummary('inactive').codeCount} <span className="text-body-sm text-on-surface-variant font-normal">codes</span></h4>
                                <div className="mt-6 space-y-2 pt-2 border-t border-outline-variant/30">
                                    <div className="flex justify-between text-[11px] font-code-sm"><span className="text-on-surface-variant">Total credits</span><span className="">{getCodeSummary('inactive').totalCredits.toFixed(2)}</span></div>
                                    <div className="flex justify-between text-[11px] font-code-sm"><span className="text-on-surface-variant">Average credits</span><span className="">{getCodeSummary('inactive').averageCredits.toFixed(2)}</span></div>
                                </div>
                            </div>
                            <div className="bg-surface-container-high/40 rounded-lg p-6 border border-outline-variant">
                                <p className="font-label-caps text-[10px] text-error mb-2">EXHAUSTED</p>
                                <h4 className="text-[28px] font-bold text-on-surface">{getCodeSummary('exhausted').codeCount} <span className="text-body-sm text-on-surface-variant font-normal">codes</span></h4>
                                <div className="mt-6 space-y-2 pt-2 border-t border-outline-variant/30">
                                    <div className="flex justify-between text-[11px] font-code-sm"><span className="text-on-surface-variant">Total credits</span><span className="">{getCodeSummary('exhausted').totalCredits.toFixed(2)}</span></div>
                                    <div className="flex justify-between text-[11px] font-code-sm"><span className="text-on-surface-variant">Average credits</span><span className="">{getCodeSummary('exhausted').averageCredits.toFixed(2)}</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
            
            {/* Visual Polish: Decorative Elements */}
            <div className="absolute top-0 right-0 -z-10 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 -z-10 w-[400px] h-[400px] bg-tertiary/5 rounded-full blur-[100px] pointer-events-none"></div>
        </main>
    );
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
