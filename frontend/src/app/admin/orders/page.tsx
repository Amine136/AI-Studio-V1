"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../services/api";
import type { AdminCreditOrder, CreditOrderStatus } from "../../../types";

type StatusFilter = "all" | CreditOrderStatus;

const STATUS_STYLES: Record<CreditOrderStatus, string> = {
    pending: "bg-primary/10 text-primary border-primary/20",
    accepted: "bg-secondary/10 text-secondary border-secondary/20",
    refused: "bg-error/10 text-error border-error/20",
};

const METHOD_LABELS: Record<string, string> = {
    flouci: "Flouci",
    bank_transfer: "Bank transfer / RIB",
    d17: "D17",
    edinar_post: "E-dinar Post",
};

function formatTimestamp(timestamp?: number | null): string {
    if (!timestamp) return "unknown";
    return new Date(timestamp * 1000).toLocaleString();
}

// TND arrives as millimes.
function formatPrice(priceMinor: number, currency: string): string {
    const amount = priceMinor / 1000;
    const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(3).replace(/0+$/, "");
    return currency === "TND" ? `${text} DT` : `${text} ${currency}`;
}

// Amount bounds are typed in whole currency units (DT); orders carry millimes.
// Rounded, because TND has three decimals and a typed 1.005 floats to
// 1004.9999… — which would quietly exclude an order priced at exactly 1005.
function parseAmountBound(raw: string): number | null {
    const value = Number(raw.trim());
    return raw.trim() !== "" && Number.isFinite(value) ? Math.round(value * 1000) : null;
}

export default function AdminOrdersPage() {
    const [orders, setOrders] = useState<AdminCreditOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [filter, setFilter] = useState<StatusFilter>("pending");
    const [page, setPage] = useState(1);
    const itemsPerPage = 10;

    // Secondary filters, hidden behind a toggle so the default view stays the
    // plain queue. All three narrow client-side — the list endpoint returns
    // every order already.
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [methodFilter, setMethodFilter] = useState("all");
    const [minAmount, setMinAmount] = useState("");
    const [maxAmount, setMaxAmount] = useState("");
    const [userQuery, setUserQuery] = useState("");

    // Proof opened in the lightbox, so a receipt can be read without a new tab.
    const [lightbox, setLightbox] = useState<string | null>(null);

    // Per-row editing state, keyed by order id so two open rows don't fight.
    const [activeId, setActiveId] = useState<string | null>(null);
    const [action, setAction] = useState<"accept" | "refuse" | null>(null);
    const [codeInput, setCodeInput] = useState("");
    const [reasonInput, setReasonInput] = useState("");
    const [confirmMismatch, setConfirmMismatch] = useState(false);
    const [rowError, setRowError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [generating, setGenerating] = useState(false);
    // Proof ids that failed to render as an image (PDFs).
    const [unrenderable, setUnrenderable] = useState<Set<string>>(new Set());

    const loadOrders = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const response = await api.getAdminCreditOrders();
            setOrders(response.orders ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load orders.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    useEffect(() => {
        if (!lightbox) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setLightbox(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [lightbox]);

    // Built from the data, not METHOD_LABELS: paymentMethod is a free string and
    // a method we don't have a label for still has to be filterable.
    const methodOptions = useMemo(() => {
        const seen = new Set(orders.map((order) => order.paymentMethod).filter(Boolean));
        return [...seen].sort((a, b) =>
            (METHOD_LABELS[a] ?? a).localeCompare(METHOD_LABELS[b] ?? b),
        );
    }, [orders]);

    const filteredOrders = useMemo(() => {
        const min = parseAmountBound(minAmount);
        const max = parseAmountBound(maxAmount);
        const needle = userQuery.trim().toLowerCase();
        return orders.filter((order) => {
            if (filter !== "all" && order.status !== filter) return false;
            if (methodFilter !== "all" && order.paymentMethod !== methodFilter) return false;
            if (min !== null && order.priceMinor < min) return false;
            if (max !== null && order.priceMinor > max) return false;
            if (needle) {
                const haystack = [order.userEmail, order.userDisplayName, order.uid]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                if (!haystack.includes(needle)) return false;
            }
            return true;
        });
    }, [orders, filter, methodFilter, minAmount, maxAmount, userQuery]);

    // Deliberately over all orders, not the filtered set — this is the global
    // "you have work waiting" signal.
    const pendingCount = useMemo(
        () => orders.filter((order) => order.status === "pending").length,
        [orders],
    );

    const activeFilterCount =
        (methodFilter !== "all" ? 1 : 0) +
        (minAmount.trim() ? 1 : 0) +
        (maxAmount.trim() ? 1 : 0) +
        (userQuery.trim() ? 1 : 0);

    const totalPages = Math.max(1, Math.ceil(filteredOrders.length / itemsPerPage));
    const paginatedOrders = useMemo(() => {
        const start = (page - 1) * itemsPerPage;
        return filteredOrders.slice(start, start + itemsPerPage);
    }, [filteredOrders, page, itemsPerPage]);

    const setStatusFilter = (next: StatusFilter) => {
        setFilter(next);
        setPage(1);
    };

    // Every filter change has to rewind the page, or narrowing the list while on
    // page 3 lands on an empty one.
    const applyFilter = <T,>(setter: (value: T) => void) => (value: T) => {
        setter(value);
        setPage(1);
    };

    const clearFilters = () => {
        setMethodFilter("all");
        setMinAmount("");
        setMaxAmount("");
        setUserQuery("");
        setPage(1);
    };

    const openAction = (orderId: string, next: "accept" | "refuse") => {
        setActiveId(orderId);
        setAction(next);
        setCodeInput("");
        setReasonInput("");
        setConfirmMismatch(false);
        setRowError("");
    };

    const closeAction = () => {
        setActiveId(null);
        setAction(null);
        setRowError("");
    };

    // Mint a code for exactly this order's amount, single use, no expiry, and drop
    // it into the field. Saves the round trip to Codes; accepting still goes
    // through the same validation as a hand-pasted code.
    const generateCode = async (order: AdminCreditOrder) => {
        if (generating) return;
        setGenerating(true);
        setRowError("");
        try {
            const created = await api.createAdminCode(order.credits, 1, 0, 0);
            const code = String(created?.code || "");
            if (!code) throw new Error("Code generation returned no code.");
            setCodeInput(code);
        } catch (err) {
            setRowError(err instanceof Error ? err.message : "Failed to generate a code.");
        } finally {
            setGenerating(false);
        }
    };

    const submitAction = async (order: AdminCreditOrder) => {
        if (submitting) return;
        setSubmitting(true);
        setRowError("");
        try {
            const updated =
                action === "accept"
                    ? await api.acceptAdminCreditOrder(order.id, codeInput, confirmMismatch)
                    : await api.refuseAdminCreditOrder(order.id, reasonInput);
            setOrders((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
            closeAction();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to update this order.";
            setRowError(message);
            // The mismatch guard is the one error the admin can override in place.
            if (/different number of credits/i.test(message)) setConfirmMismatch(false);
        } finally {
            setSubmitting(false);
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
            {/* Header */}
            <section className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8 sm:mb-10 max-w-[1440px] mx-auto">
                <div>
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-2">
                        <h2 className="font-headline-lg text-headline-lg text-primary">Credit Orders</h2>
                        {pendingCount > 0 ? (
                            <span className="px-2 py-1 bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold rounded uppercase tracking-tighter">{pendingCount} Pending</span>
                        ) : null}
                    </div>
                    <p className="font-body-lg text-on-surface-variant max-w-2xl">
                        Manual credit purchases awaiting review. Accepting issues a redeem code to the buyer —
                        generate one in place, or paste a code you made in{" "}
                        <Link href="/admin/codes" className="text-primary hover:underline">Codes</Link>.
                    </p>
                </div>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 shrink-0">
                    {(["all", "pending", "accepted", "refused"] as StatusFilter[]).map((option) => (
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

            <div className="max-w-[1440px] mx-auto">
                <section className="nebula-glass rounded-2xl p-4 sm:p-6">
                    <div className="flex flex-wrap items-center gap-3 justify-between mb-4 pb-4 border-b border-outline-variant">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-primary">receipt_long</span>
                            <h3 className="font-title-md text-title-md text-on-surface">Orders</h3>
                            <span className="font-label-caps text-secondary bg-secondary/10 px-3 py-1 rounded-full border border-secondary/20">{filteredOrders.length} ITEMS</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFiltersOpen((open) => !open)}
                            aria-expanded={filtersOpen}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-label-caps text-label-caps transition-colors ${
                                filtersOpen || activeFilterCount > 0
                                    ? "bg-primary-container text-on-primary-container border-primary/20"
                                    : "text-on-surface-variant border-outline-variant hover:bg-surface-container-highest"
                            }`}
                        >
                            <span className="material-symbols-outlined text-[16px]">tune</span>
                            Filters
                            {activeFilterCount > 0 ? (
                                <span className="ms-0.5 rounded-full bg-primary/20 px-1.5 text-[10px] font-bold">{activeFilterCount}</span>
                            ) : null}
                        </button>
                    </div>

                    {/* Collapse is a conditional render, not a `hidden` class: admin.css
                        carries unlayered `display` rules that beat Tailwind here. */}
                    {filtersOpen ? (
                        <div className="mb-6 rounded-lg border border-outline-variant bg-surface-container-lowest/60 p-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                                <label className="flex flex-col gap-1.5 min-w-0">
                                    <span className="font-label-caps text-[10px] text-on-surface-variant">PAYMENT METHOD</span>
                                    <select
                                        value={methodFilter}
                                        onChange={(e) => applyFilter(setMethodFilter)(e.target.value)}
                                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-body-sm text-on-surface outline-none focus:border-primary/50"
                                    >
                                        <option value="all">All methods</option>
                                        {methodOptions.map((method) => (
                                            <option key={method} value={method}>
                                                {METHOD_LABELS[method] ?? method}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className="flex flex-col gap-1.5 min-w-0">
                                    <span className="font-label-caps text-[10px] text-on-surface-variant">USER</span>
                                    <input
                                        type="text"
                                        value={userQuery}
                                        onChange={(e) => applyFilter(setUserQuery)(e.target.value)}
                                        placeholder="Email, name or uid…"
                                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-body-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/50"
                                    />
                                </label>

                                {/* Bounds are in DT and inclusive; orders store millimes. */}
                                <label className="flex flex-col gap-1.5 min-w-0">
                                    <span className="font-label-caps text-[10px] text-on-surface-variant">MIN AMOUNT (DT)</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        min={0}
                                        value={minAmount}
                                        onChange={(e) => applyFilter(setMinAmount)(e.target.value)}
                                        placeholder="0"
                                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-body-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/50"
                                    />
                                </label>

                                <label className="flex flex-col gap-1.5 min-w-0">
                                    <span className="font-label-caps text-[10px] text-on-surface-variant">MAX AMOUNT (DT)</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        min={0}
                                        value={maxAmount}
                                        onChange={(e) => applyFilter(setMaxAmount)(e.target.value)}
                                        placeholder="Any"
                                        className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-body-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:border-primary/50"
                                    />
                                </label>
                            </div>

                            {activeFilterCount > 0 ? (
                                <button
                                    type="button"
                                    onClick={clearFilters}
                                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-container-highest transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                    Clear filters
                                </button>
                            ) : null}
                        </div>
                    ) : null}

                    {error ? <p className="text-sm text-error mb-4">{error}</p> : null}

                    <div className="grid grid-cols-1 gap-4">
                        {paginatedOrders.length === 0 ? (
                            <p className="text-sm text-on-surface-variant">
                                {activeFilterCount > 0
                                    ? "No orders match these filters."
                                    : "No orders here yet."}
                            </p>
                        ) : (
                            paginatedOrders.map((order) => {
                                const isPending = order.status === "pending";
                                const isActive = activeId === order.id;
                                return (
                                    <div
                                        key={order.id}
                                        className={`bg-surface-container-high rounded-lg p-4 sm:p-5 border border-outline-variant transition-all ${
                                            isPending ? "border-l-4 border-l-primary" : "opacity-80"
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2">
                                                    <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-widest ${STATUS_STYLES[order.status]}`}>
                                                        {order.status}
                                                    </span>
                                                    <span className="text-xs text-on-surface-variant">{formatTimestamp(order.createdAt)}</span>
                                                    <span className="px-2 py-0.5 bg-surface-container-lowest rounded border border-outline-variant font-code-sm text-[11px] text-secondary">
                                                        {METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
                                                    </span>
                                                </div>

                                                {/* Plan, price and buyer read as one line on a wide screen and
                                                    wrap to their own rows on a phone. */}
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2">
                                                    <p className="text-on-surface font-body-sm">
                                                        <span className="font-bold">{order.planName}</span>
                                                        {" — "}
                                                        {order.credits.toFixed(2)} Cr for{" "}
                                                        <span className="text-primary font-bold">{formatPrice(order.priceMinor, order.currency)}</span>
                                                    </p>
                                                    <span className="min-w-0 max-w-full truncate px-2 py-0.5 bg-surface-container-lowest rounded border border-outline-variant font-code-sm text-[11px] text-on-surface">
                                                        {order.userEmail || order.uid || "unknown"}
                                                    </span>
                                                    {order.resolvedByEmail ? (
                                                        <span className="min-w-0 max-w-full truncate font-code-sm text-[11px] text-on-surface-variant">
                                                            by {order.resolvedByEmail}
                                                        </span>
                                                    ) : null}
                                                </div>

                                                {order.note ? (
                                                    <p className="text-on-surface-variant font-body-sm whitespace-pre-wrap break-words mb-3 border-s-2 border-outline-variant ps-3">
                                                        {order.note}
                                                    </p>
                                                ) : null}

                                                {/* Sits directly above the receipts it is talking about — this is
                                                    the one thing on the row that argues against approving. */}
                                                {order.duplicateProofs && order.duplicateProofs.length > 0 ? (
                                                    <div className="mb-3 flex gap-2 rounded-lg border border-error/40 bg-error/5 p-3 text-error">
                                                        <span className="material-symbols-outlined text-[18px] leading-none">warning</span>
                                                        <div className="font-body-sm">
                                                            <p className="font-medium">This receipt was already submitted.</p>
                                                            <ul className="mt-1 space-y-0.5">
                                                                {order.duplicateProofs.map((dup) => (
                                                                    <li key={dup.orderId} className="font-code-sm text-[11px]">
                                                                        order {dup.orderId} — {dup.status},{" "}
                                                                        {new Date(dup.createdAt * 1000).toLocaleDateString()}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    </div>
                                                ) : null}

                                                {/* Proofs. Admin auth is a same-origin cookie, so these load directly.
                                                    Reading the receipt is the whole job, so an image opens in the
                                                    lightbox rather than costing a tab round trip. */}
                                                {order.proofFileIds.length > 0 ? (
                                                    <div className="flex flex-wrap gap-3 mb-1">
                                                        {order.proofFileIds.map((fileId) => {
                                                            const src = `/api/admin/orders/${order.id}/proof/${fileId}`;
                                                            // A PDF proof can't render in <img>, so it falls back to a
                                                            // labelled tile that still opens the file in a tab.
                                                            const isFile = unrenderable.has(fileId);
                                                            const tile =
                                                                "group relative flex h-28 w-28 sm:h-36 sm:w-36 items-center justify-center rounded-lg border border-outline-variant overflow-hidden bg-surface-container-lowest hover:border-primary/40 transition-colors";
                                                            if (isFile) {
                                                                return (
                                                                    <a
                                                                        key={fileId}
                                                                        href={src}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className={tile}
                                                                    >
                                                                        <span className="flex flex-col items-center gap-1 text-primary">
                                                                            <span className="material-symbols-outlined text-[26px]">description</span>
                                                                            <span className="font-code-sm text-[10px]">Open file</span>
                                                                        </span>
                                                                    </a>
                                                                );
                                                            }
                                                            return (
                                                                <button
                                                                    key={fileId}
                                                                    type="button"
                                                                    onClick={() => setLightbox(src)}
                                                                    className={tile}
                                                                    aria-label="Enlarge payment proof"
                                                                >
                                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                    <img
                                                                        src={src}
                                                                        alt="Payment proof"
                                                                        className="h-full w-full object-cover"
                                                                        onError={() =>
                                                                            setUnrenderable((current) => new Set(current).add(fileId))
                                                                        }
                                                                    />
                                                                    <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-white group-hover:flex">
                                                                        <span className="material-symbols-outlined text-[22px]">zoom_in</span>
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                ) : null}

                                                {order.status === "accepted" && order.code ? (
                                                    <p className="mt-3 font-code-sm text-[11px] text-secondary">
                                                        Code issued: {order.code}
                                                    </p>
                                                ) : null}
                                                {order.status === "refused" && order.adminMessage ? (
                                                    <p className="mt-3 text-sm text-error">{order.adminMessage}</p>
                                                ) : null}
                                            </div>

                                            {isPending && !isActive ? (
                                                <div className="grid grid-cols-2 sm:flex shrink-0 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => openAction(order.id, "accept")}
                                                        className="px-4 py-2 rounded-lg font-label-caps text-label-caps border bg-primary-container text-on-primary-container border-primary/20 hover:opacity-90 transition-colors"
                                                    >
                                                        Accept
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openAction(order.id, "refuse")}
                                                        className="px-4 py-2 rounded-lg font-label-caps text-label-caps border border-outline-variant text-on-surface-variant hover:bg-surface-container-highest transition-colors"
                                                    >
                                                        Refuse
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>

                                        {/* Inline accept / refuse panel */}
                                        {isActive ? (
                                            <div className="mt-4 pt-4 border-t border-outline-variant">
                                                {action === "accept" ? (
                                                    <>
                                                        <label className="block font-label-caps text-[10px] text-on-surface-variant mb-2">
                                                            REDEEM CODE ({order.credits.toFixed(2)} Cr)
                                                        </label>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <input
                                                                type="text"
                                                                value={codeInput}
                                                                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                                                                placeholder="VC-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                                                                className="w-full sm:w-auto sm:flex-1 sm:min-w-[20rem] max-w-xl px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant font-code-sm text-sm text-on-surface outline-none focus:border-primary/50"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => void generateCode(order)}
                                                                disabled={generating || submitting}
                                                                className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-label-caps text-label-caps border border-outline-variant text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">bolt</span>
                                                                {generating ? "Generating…" : "Generate"}
                                                            </button>
                                                        </div>
                                                        <p className="text-[11px] text-on-surface-variant mt-2">
                                                            Generate creates a single-use code worth exactly {order.credits.toFixed(2)} Cr that never
                                                            expires, and drops it in the field. Or paste one you made in Codes.
                                                        </p>
                                                        {/different number of credits/i.test(rowError) ? (
                                                            <label className="flex items-center gap-2 mt-3 text-sm text-on-surface-variant">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={confirmMismatch}
                                                                    onChange={(e) => setConfirmMismatch(e.target.checked)}
                                                                />
                                                                Use this code anyway
                                                            </label>
                                                        ) : null}
                                                    </>
                                                ) : (
                                                    <>
                                                        <label className="block font-label-caps text-[10px] text-on-surface-variant mb-2">
                                                            REASON (shown to the user, optional)
                                                        </label>
                                                        <textarea
                                                            value={reasonInput}
                                                            maxLength={400}
                                                            rows={3}
                                                            onChange={(e) => setReasonInput(e.target.value)}
                                                            className="w-full max-w-xl px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant font-body-sm text-sm text-on-surface outline-none focus:border-primary/50 resize-none"
                                                        />
                                                    </>
                                                )}

                                                {rowError ? <p className="text-sm text-error mt-3">{rowError}</p> : null}

                                                <div className="flex items-center gap-2 mt-4">
                                                    <button
                                                        type="button"
                                                        onClick={() => void submitAction(order)}
                                                        disabled={submitting || (action === "accept" && codeInput.trim().length < 3)}
                                                        className="px-4 py-2 rounded-lg font-label-caps text-label-caps border bg-primary-container text-on-primary-container border-primary/20 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                    >
                                                        {submitting ? "Saving…" : action === "accept" ? "Confirm Accept" : "Confirm Refuse"}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={closeAction}
                                                        className="px-4 py-2 rounded-lg font-label-caps text-label-caps border border-outline-variant text-on-surface-variant hover:bg-surface-container-highest transition-colors"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : null}
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

            {/* Proof lightbox. Click anywhere or Esc closes; the original stays
                one click away for zooming past the viewport. It sits above the
                mobile bottom nav (z-50) and the More sheet (z-60). */}
            {lightbox ? (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Payment proof"
                    onClick={() => setLightbox(null)}
                    className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-black/80 p-4 pb-24 lg:pb-4 backdrop-blur-sm"
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={lightbox}
                        alt="Payment proof"
                        className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
                    />
                    <div className="flex items-center gap-2">
                        <a
                            href={lightbox}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/20 bg-white/10 font-label-caps text-label-caps text-white hover:bg-white/20 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                            Open original
                        </a>
                        <button
                            type="button"
                            onClick={() => setLightbox(null)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/20 font-label-caps text-label-caps text-white hover:bg-white/10 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            ) : null}
        </main>
    );
}
