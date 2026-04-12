"use client";

import { useEffect, useMemo, useState } from "react";

import AdminSubpage from "../_components/AdminSubpage";
import { api } from "../../../services/api";
import type { AdminUserListItem } from "../../../types";

type StatusFilter = "all" | "active" | "suspended";

export default function AdminUsersPage() {
    const [users, setUsers] = useState<AdminUserListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [actingUid, setActingUid] = useState("");
    const [reasonByUid, setReasonByUid] = useState<Record<string, string>>({});
    const [feedbackByUid, setFeedbackByUid] = useState<Record<string, string>>({});
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

    useEffect(() => {
        let cancelled = false;

        const loadInitialUsers = async () => {
            setLoading(true);
            setError("");
            try {
                const response = await api.getAdminUsers({ limit: 100 });
                if (!cancelled) {
                    setUsers(response.users ?? []);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Unable to load users.");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadInitialUsers();

        return () => {
            cancelled = true;
        };
    }, []);

    const loadUsers = async () => {
        setLoading(true);
        setError("");
        try {
            const response = await api.getAdminUsers({ limit: 100 });
            setUsers(response.users ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to load users.");
        } finally {
            setLoading(false);
        }
    };

    const filteredUsers = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        return users.filter((user) => {
            const matchesQuery = !normalizedQuery || [
                user.displayName,
                user.email,
                user.uid,
            ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));

            const matchesFilter =
                statusFilter === "all" ||
                (statusFilter === "active" && !user.isSuspended) ||
                (statusFilter === "suspended" && user.isSuspended);

            return matchesQuery && matchesFilter;
        });
    }, [query, statusFilter, users]);

    const handleStatusChange = async (user: AdminUserListItem) => {
        const reason = (reasonByUid[user.uid] || "").trim();
        if (!reason) {
            setFeedbackByUid((current) => ({
                ...current,
                [user.uid]: "Reason is required.",
            }));
            return;
        }

        setActingUid(user.uid);
        setFeedbackByUid((current) => ({
            ...current,
            [user.uid]: "",
        }));

        try {
            if (user.isSuspended) {
                await api.unsuspendAdminUser(user.uid, reason);
            } else {
                await api.suspendAdminUser(user.uid, reason);
            }

            await loadUsers();
            setReasonByUid((current) => ({
                ...current,
                [user.uid]: "",
            }));
            setFeedbackByUid((current) => ({
                ...current,
                [user.uid]: user.isSuspended ? "User unsuspended." : "User suspended.",
            }));
        } catch (err) {
            setFeedbackByUid((current) => ({
                ...current,
                [user.uid]: err instanceof Error ? err.message : "Unable to update user status.",
            }));
        } finally {
            setActingUid("");
        }
    };

    const exportCsv = () => {
        const headers = ["Name", "Email", "UID", "Credits", "Reserved", "Status", "Reason"];
        const rows = filteredUsers.map((user) => [
            csvValue(user.displayName || "Anonymous"),
            csvValue(user.email || ""),
            csvValue(user.uid),
            csvValue(user.credits.toFixed(2)),
            csvValue(user.reservedCredits.toFixed(2)),
            csvValue(user.isSuspended ? "Suspended" : "Active"),
            csvValue(user.suspensionReason || ""),
        ]);
        const content = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
        const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "admin-users.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <AdminSubpage title="Admin Users" description="User search, balance visibility, and suspension controls.">
            <section className="glass-card overflow-hidden border border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.4)] animate-fade-in-up">
                <div className="border-b border-white/8 px-5 py-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-center gap-3">
                            <div>
                                <h2 className="text-base font-semibold text-white">All Users</h2>
                                <p className="text-xs text-slate-500">Current balances and suspension state</p>
                            </div>
                            <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs font-semibold text-violet-200">
                                {filteredUsers.length} users
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={exportCsv}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.02] px-4 py-2 text-sm font-medium text-slate-200 transition-all duration-200 ease-in-out hover:bg-white/[0.06]"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <path d="M7 10l5 5 5-5" />
                                <path d="M12 15V3" />
                            </svg>
                            Export CSV
                        </button>
                    </div>
                </div>

                <div className="border-b border-white/8 bg-[rgba(255,255,255,0.04)] px-5 py-4">
                    <div className="flex justify-end">
                        <div className="flex w-full max-w-[420px] overflow-hidden rounded-xl border border-white/8 bg-[#1a1d2e]">
                            <div className="relative min-w-0 flex-1">
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search users"
                                    className="w-full border-0 bg-transparent px-3 py-2.5 text-sm text-white outline-none transition-all duration-200 ease-in-out placeholder:text-slate-500 focus:ring-0"
                                />
                            </div>
                            <div className="w-px bg-white/8" />
                            <select
                                value={statusFilter}
                                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                                className="min-w-[132px] border-0 bg-transparent px-3 py-2.5 text-sm text-slate-200 outline-none transition-all duration-200 ease-in-out focus:ring-0"
                            >
                                <option value="all">All users</option>
                                <option value="active">Active</option>
                                <option value="suspended">Suspended</option>
                            </select>
                        </div>
                    </div>
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
                    <div className="overflow-x-auto">
                        <table className="admin-table">
                            <thead className="sticky top-0 z-10">
                                <tr className="border-b border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]">
                                    <th className="font-semibold tracking-[0.08em] text-slate-300">User</th>
                                    <th className="font-semibold tracking-[0.08em] text-slate-300">Credits</th>
                                    <th className="font-semibold tracking-[0.08em] text-slate-300">Reserved</th>
                                    <th className="font-semibold tracking-[0.08em] text-slate-300">Status</th>
                                    <th className="font-semibold tracking-[0.08em] text-slate-300">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map((user) => (
                                    <tr key={user.uid} className="group border-b border-white/6 transition-all duration-150 ease-in-out hover:bg-[rgba(255,255,255,0.025)]">
                                        <td className="relative py-3 pl-6 before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] before:bg-transparent before:transition-all before:duration-150 group-hover:before:bg-[rgba(124,58,237,0.7)]">
                                            <div className="admin-user-cell">
                                                <div
                                                    className="admin-avatar text-white"
                                                    style={{ background: avatarGradientForUser(user.uid || user.email || user.displayName || "?") }}
                                                >
                                                    {(user.displayName || user.email || "?").charAt(0).toUpperCase()}
                                                </div>
                                                <div className="admin-user-info">
                                                    <div className="flex items-center gap-2">
                                                        <span className="admin-user-name">{user.displayName || "Anonymous"}</span>
                                                    </div>
                                                    <span className="admin-user-uid">{user.email || user.uid}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-3">
                                            <CreditTierBadge value={user.credits} />
                                        </td>
                                        <td className="py-3">
                                            <span className="text-sm text-slate-300">{user.reservedCredits.toFixed(2)}</span>
                                        </td>
                                        <td className="py-3">
                                            <StatusChip user={user} />
                                        </td>
                                        <td className="py-3">
                                            <div className="min-w-[280px]">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={reasonByUid[user.uid] || ""}
                                                        onChange={(event) =>
                                                            setReasonByUid((current) => ({
                                                                ...current,
                                                                [user.uid]: event.target.value,
                                                            }))
                                                        }
                                                        placeholder={user.isSuspended ? "Reason to unsuspend" : "Reason to suspend"}
                                                        className="min-w-0 flex-1 rounded-xl border border-white/8 bg-[#1a1d2e] px-3 py-2 text-sm text-white outline-none transition-all duration-200 ease-in-out placeholder:text-slate-500 focus:border-violet-400/40 focus:ring-2 focus:ring-violet-500/30"
                                                    />
                                                    <button
                                                        onClick={() => void handleStatusChange(user)}
                                                        disabled={actingUid === user.uid}
                                                        className={
                                                            user.isSuspended
                                                                ? "inline-flex items-center justify-center rounded-xl border border-emerald-400/30 px-3 py-2 text-sm font-semibold text-emerald-300 transition-all duration-200 ease-in-out hover:bg-emerald-400/10"
                                                                : "inline-flex items-center justify-center rounded-[10px] bg-[linear-gradient(135deg,#dc2626,#b91c1c)] px-3 py-2 text-sm font-semibold text-white transition-all duration-200 ease-in-out hover:-translate-y-[1px] hover:shadow-[0_4px_15px_rgba(220,38,38,0.35)]"
                                                        }
                                                    >
                                                        {actingUid === user.uid ? (
                                                            "Saving..."
                                                        ) : user.isSuspended ? (
                                                            "Unsuspend"
                                                        ) : (
                                                            "Suspend"
                                                        )}
                                                    </button>
                                                </div>
                                                {feedbackByUid[user.uid] ? (
                                                    <p className={`mt-2 text-xs ${feedbackByUid[user.uid] === "User suspended." || feedbackByUid[user.uid] === "User unsuspended." ? "text-emerald-300" : "text-amber-300"}`}>
                                                        {feedbackByUid[user.uid]}
                                                    </p>
                                                ) : null}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </AdminSubpage>
    );
}

function CreditTierBadge({ value }: { value: number }) {
    const tier =
        value >= 5
            ? "bg-emerald-400/12 text-emerald-200 border-emerald-400/25"
            : value >= 2
                ? "bg-amber-400/12 text-amber-200 border-amber-400/25"
                : "bg-red-400/12 text-red-200 border-red-400/25";

    return (
        <span className={`inline-flex min-w-[72px] items-center justify-center rounded-full border px-3 py-1 text-sm font-semibold tabular-nums ${tier}`}>
            {value.toFixed(2)}
        </span>
    );
}

function StatusChip({ user }: { user: AdminUserListItem }) {
    const title = user.suspensionReason
        ? `${user.suspensionReason}${user.activeSuspensionUntil ? ` Until ${new Date(user.activeSuspensionUntil * 1000).toLocaleString()}` : ""}`
        : user.isSuspended
            ? "Suspended"
            : "Active";

    return (
        <span
            title={title}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${
                user.isSuspended
                    ? "border-red-400/25 bg-red-400/10 text-red-200"
                    : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
            }`}
        >
            <span className={`h-2 w-2 rounded-full ${user.isSuspended ? "bg-red-300" : "bg-emerald-300"}`} />
            {user.isSuspended ? "Suspended" : "Active"}
        </span>
    );
}

function csvValue(value: string) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function avatarGradientForUser(seed: string) {
    const gradients = [
        "linear-gradient(135deg, rgba(124,58,237,0.92), rgba(59,130,246,0.92))",
        "linear-gradient(160deg, rgba(59,130,246,0.92), rgba(124,58,237,0.92))",
        "linear-gradient(110deg, rgba(124,58,237,0.92), rgba(14,165,233,0.92))",
    ];
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
        hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }
    return gradients[hash % gradients.length];
}
