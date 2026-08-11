"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../services/api";
import type { AdminUserListItem } from "../../../types";

type StatusFilter = "all" | "active" | "suspended";

export default function AdminUsersPage() {
    const router = useRouter();
    const [users, setUsers] = useState<AdminUserListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [actingUid, setActingUid] = useState("");
    const [reasonByUid, setReasonByUid] = useState<Record<string, string>>({});
    const [feedbackByUid, setFeedbackByUid] = useState<Record<string, string>>({});
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    useEffect(() => {
        let cancelled = false;

        const loadInitialUsers = async () => {
            setLoading(true);
            setError("");
            try {
                const response = await api.getAdminUsers({ limit: 1000 });
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
        try {
            const response = await api.getAdminUsers({ limit: 1000 });
            setUsers(response.users ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to load users.");
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

    useEffect(() => {
        setCurrentPage(1);
    }, [query, statusFilter]);

    const totalPages = Math.ceil(filteredUsers.length / itemsPerPage) || 1;
    const currentUsers = filteredUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
            csvValue(user.credits?.toFixed(2) || "0.00"),
            csvValue(user.reservedCredits?.toFixed(2) || "0.00"),
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

    const totalCreditsActive = useMemo(() => {
        return users.reduce((sum, u) => sum + (u.credits || 0), 0);
    }, [users]);

    const newRegistrationsToday = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return users.filter(u => u.createdAt && new Date(u.createdAt) >= today).length;
    }, [users]);

    if (loading) {
        return (
            <main className="flex-1 overflow-y-auto p-6 min-h-[calc(100vh-4rem)] flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    if (error) {
        return (
            <main className="flex-1 overflow-y-auto p-6 min-h-[calc(100vh-4rem)] flex items-center justify-center">
                <p className="text-error">{error}</p>
            </main>
        );
    }

    return (
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar relative">
            <div className="max-w-[1440px] mx-auto space-y-6">
                {/* Hero Section */}
                <div className="mb-6 sm:mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-12 h-12 rounded-lg bg-primary-container/20 flex items-center justify-center border border-primary/20">
                                <span className="material-symbols-outlined text-primary text-3xl">group</span>
                            </div>
                            <h2 className="font-headline-lg text-headline-lg text-on-surface">Admin Users</h2>
                        </div>
                        <p className="text-on-surface-variant font-body-lg">User search, balance visibility, and suspension controls.</p>
                    </div>
                </div>

                {/* Main Data Table Container */}
                <div className="glass-panel rounded-lg overflow-hidden shadow-2xl">
                    {/* Table Controls */}
                    <div className="px-4 sm:px-6 py-4 sm:py-6 border-b border-outline-variant flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <h3 className="font-title-md text-title-md text-on-surface">All Users</h3>
                            <span className="bg-secondary-container/20 text-secondary px-3 py-1 rounded-full font-label-caps text-[10px] border border-secondary/30">
                                {filteredUsers.length} users
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                            <div className="flex-1 basis-full sm:basis-auto sm:w-64 relative">
                                <input 
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-sm focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/40 outline-none" 
                                    placeholder="Search users..." 
                                    type="text" 
                                />
                            </div>
                            <select 
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                                className="flex-1 sm:flex-none bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-sm focus:ring-2 focus:ring-primary outline-none"
                            >
                                <option value="all">All users</option>
                                <option value="active">Active</option>
                                <option value="suspended">Suspended</option>
                            </select>
                            <button onClick={exportCsv} className="flex items-center justify-center gap-2 bg-primary text-on-primary px-4 py-2 rounded-lg font-label-caps text-label-caps hover:brightness-110 transition-all whitespace-nowrap">
                                <span className="material-symbols-outlined text-sm">download</span>
                                Export CSV
                            </button>
                        </div>
                    </div>

                    {/* Data Table — scrolls sideways inside the card on narrow screens
                        rather than stretching the page; the suspend control needs the
                        room a phone can't give it. */}
                    <p className="admin-table-hint"><span className="material-symbols-outlined text-[13px]">swipe_left</span>Swipe the table sideways for more columns</p>
                    <div className="overflow-x-auto admin-table-scroll">
                        <table className="w-full min-w-[60rem] text-left">
                            <thead>
                                <tr className="bg-surface-container-highest/30">
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">User</th>
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Credits</th>
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Reserved</th>
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider text-center">Status</th>
                                    <th className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-outline-variant">
                                {currentUsers.map((user) => (
                                    <tr key={user.uid} className={`hover:bg-surface-bright transition-colors group ${user.isSuspended ? 'bg-error/5' : ''}`}>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold font-title-md border ${user.isSuspended ? 'bg-error/20 text-error border-error/20' : 'bg-primary/20 text-primary border-primary/20'}`}>
                                                    {(user.displayName || user.email || "?").charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className={`font-title-md text-body-lg text-on-surface group-hover:${user.isSuspended ? 'text-error' : 'text-primary'} transition-colors`}>{user.displayName || "Anonymous"}</p>
                                                    <p className="font-body-sm text-on-surface-variant text-xs">{user.email || user.uid}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <CreditTierBadge value={user.credits || 0} />
                                            {/* A grant does NOT settle a debt, so an admin topping
                                                this account up has to see that it owes first. Only
                                                rendered when there is one — no row shift otherwise. */}
                                            {(user.creditDebt || 0) > 0 && (
                                                <span
                                                    className="mt-1 flex items-center gap-1 text-error font-code-sm text-xs"
                                                    title="Owed from a reversed payment. Settled off the next purchase or redeemed code — an admin grant does not clear it."
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">error</span>
                                                    owes {(user.creditDebt || 0).toFixed(2)}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-on-surface-variant font-code-sm">
                                            {(user.reservedCredits || 0).toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex justify-center">
                                                <StatusChip user={user} />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <input 
                                                    type="text" 
                                                    value={reasonByUid[user.uid] || ""}
                                                    onChange={(e) => setReasonByUid(curr => ({ ...curr, [user.uid]: e.target.value }))}
                                                    className={`bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-1.5 text-xs w-48 focus:ring-1 transition-all placeholder:text-on-surface-variant/30 outline-none ${user.isSuspended ? 'focus:ring-tertiary focus:border-tertiary' : 'focus:ring-error focus:border-error'}`} 
                                                    placeholder={user.isSuspended ? "Reason to unsuspend" : "Reason to suspend"}
                                                />
                                                <button 
                                                    disabled={actingUid === user.uid}
                                                    onClick={() => handleStatusChange(user)}
                                                    className={
                                                        user.isSuspended 
                                                        ? "bg-tertiary/20 text-tertiary border border-tertiary px-4 py-1.5 rounded-lg font-label-caps text-label-caps hover:bg-tertiary hover:text-on-tertiary transition-all disabled:opacity-50" 
                                                        : "bg-error text-on-error px-4 py-1.5 rounded-lg font-label-caps text-label-caps hover:bg-error/80 transition-all disabled:opacity-50"
                                                    }
                                                >
                                                    {actingUid === user.uid ? "Saving..." : user.isSuspended ? "Unsuspend" : "Suspend"}
                                                </button>
                                            </div>
                                            {feedbackByUid[user.uid] && (
                                                <p className={`mt-1 text-xs ${feedbackByUid[user.uid].includes("unsuspended") ? "text-tertiary" : "text-error"}`}>
                                                    {feedbackByUid[user.uid]}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {currentUsers.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-on-surface-variant text-sm">
                                            No users found matching your criteria.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {filteredUsers.length > 0 && (
                        <div className="px-4 sm:px-6 py-4 border-t border-outline-variant flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                            <p className="font-body-sm text-on-surface-variant text-xs">
                                Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredUsers.length)} of {filteredUsers.length} users
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                                <button 
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(p => p - 1)}
                                    className="p-2 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-all"
                                >
                                    <span className="material-symbols-outlined text-sm">chevron_left</span>
                                </button>
                                
                                {Array.from({ length: totalPages }, (_, i) => i + 1)
                                    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                                    .map((p, i, arr) => {
                                        if (i > 0 && arr[i - 1] !== p - 1) {
                                            return <span key={`ellipsis-${p}`} className="text-on-surface-variant">...</span>;
                                        }
                                        return (
                                            <button 
                                                key={p}
                                                onClick={() => setCurrentPage(p)}
                                                className={`w-8 h-8 rounded-lg font-label-caps text-xs transition-all ${
                                                    currentPage === p 
                                                    ? 'bg-primary text-on-primary' 
                                                    : 'border border-outline-variant text-on-surface-variant hover:text-on-surface'
                                                }`}
                                            >
                                                {p}
                                            </button>
                                        );
                                    })
                                }

                                <button 
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage(p => p + 1)}
                                    className="p-2 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-all"
                                >
                                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* System Stats / Bento Style Extra Section */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8 pb-10">
                    <div className="glass-panel p-6 rounded-lg flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-tertiary/10 flex items-center justify-center border border-tertiary/20">
                            <span className="material-symbols-outlined text-tertiary">verified_user</span>
                        </div>
                        <div>
                            <p className="font-label-caps text-[10px] text-on-surface-variant uppercase">New Registrations</p>
                            <h4 className="font-title-md text-title-md text-on-surface">+{newRegistrationsToday} today</h4>
                        </div>
                    </div>
                    <div className="glass-panel p-6 rounded-lg flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
                            <span className="material-symbols-outlined text-primary">payments</span>
                        </div>
                        <div>
                            <p className="font-label-caps text-[10px] text-on-surface-variant uppercase">Total Credits Active</p>
                            <h4 className="font-title-md text-title-md text-on-surface">{totalCreditsActive.toFixed(2)}</h4>
                        </div>
                    </div>
                    <div className="glass-panel p-6 rounded-lg flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center border border-error/20">
                            <span className="material-symbols-outlined text-error">gpp_maybe</span>
                        </div>
                        <div>
                            <p className="font-label-caps text-[10px] text-on-surface-variant uppercase">Critical Warnings</p>
                            <h4 className="font-title-md text-title-md text-on-surface">0 Pending</h4>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}

function CreditTierBadge({ value }: { value: number }) {
    const tier =
        value >= 5
            ? "bg-tertiary/10 text-tertiary border-tertiary/20"
            : value >= 2
                ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                : "bg-surface-variant text-on-surface-variant border-outline-variant";

    return (
        <span className={`font-code-sm text-code-sm px-4 py-1.5 rounded-full border ${tier}`}>
            {value.toFixed(2)}
        </span>
    );
}

function StatusChip({ user }: { user: AdminUserListItem }) {
    return (
        <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-label-caps text-[10px] border w-max mx-auto ${
            user.isSuspended 
                ? "bg-error/10 text-error border-error/20" 
                : "bg-tertiary/10 text-tertiary border-tertiary/20"
        }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${user.isSuspended ? "bg-error" : "bg-tertiary animate-pulse"}`}></span> 
            {user.isSuspended ? "Suspended" : "Active"}
        </span>
    );
}

function csvValue(value: string) {
    return `"${String(value).replace(/"/g, '""')}"`;
}
