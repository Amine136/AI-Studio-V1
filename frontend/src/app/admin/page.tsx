"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getAllUsers, addCredits, deductCredits, getProfile, UserRecord } from "../../lib/credits";
import { createCreditCode, getAllCreditCodes, CreditCode } from "../../lib/creditCodes";
import { useAuth } from "../../context/AuthContext";
import AnimatedLogo from "../../components/AnimatedLogo";

export default function AdminPage() {
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();
    const [authorized, setAuthorized] = useState<boolean | null>(null);

    const [users, setUsers] = useState<UserRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    // Credit codes state
    const [codes, setCodes] = useState<CreditCode[]>([]);
    const [newCodeCredits, setNewCodeCredits] = useState(1);
    const [newCodeMaxClaims, setNewCodeMaxClaims] = useState(10);
    const [creatingCode, setCreatingCode] = useState(false);
    const [codeCreated, setCodeCreated] = useState<string | null>(null);

    useEffect(() => {
        if (!authLoading && !user) {
            router.replace("/auth");
        }
    }, [authLoading, user, router]);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const all = await getAllUsers();
            setUsers(all);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchCodes = useCallback(async () => {
        const all = await getAllCreditCodes();
        setCodes(all);
    }, []);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;

        const loadAccess = async () => {
            try {
                const profile = await getProfile();
                if (cancelled) return;
                setAuthorized(profile.isAdmin);
                if (profile.isAdmin) {
                    fetchUsers();
                    fetchCodes();
                }
            } catch {
                if (!cancelled) setAuthorized(false);
            }
        };

        loadAccess();
        return () => {
            cancelled = true;
        }
    }, [user, fetchUsers, fetchCodes]);

    const handleCreateCode = async () => {
        setCreatingCode(true);
        try {
            const code = await createCreditCode(newCodeCredits, newCodeMaxClaims);
            setCodeCreated(code.code);
            await fetchCodes();
            setTimeout(() => setCodeCreated(null), 5000);
        } finally {
            setCreatingCode(false);
        }
    };

    const handleAddCredit = async (uid: string) => {
        setUpdating(uid);
        await addCredits(uid, 1);
        await fetchUsers();
        setUpdating(null);
    };

    const handleDeductCredit = async (uid: string, currentCredits: number) => {
        if (currentCredits <= 0) return;
        setUpdating(uid);
        await deductCredits(uid, 1);
        await fetchUsers();
        setUpdating(null);
    };

    if (authLoading || !user || authorized === null) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    if (!authorized) {
        return (
            <main className="min-h-screen flex items-center justify-center px-4">
                <div className="glass-card p-8 max-w-md w-full text-center">
                    <h1 className="text-2xl font-extrabold gradient-text">Admin Access</h1>
                    <p className="text-sm text-gray-400 mt-3">
                        Your account is not authorized to access the admin panel.
                    </p>
                    <button
                        onClick={() => router.push("/")}
                        className="btn-primary mt-6 w-full"
                    >
                        <span>Back to Studio</span>
                    </button>
                </div>
            </main>
        );
    }

    const filteredUsers = users.filter(
        (u) =>
            u.email.toLowerCase().includes(search.toLowerCase()) ||
            u.displayName.toLowerCase().includes(search.toLowerCase())
    );

    const totalCredits = users.reduce((sum, u) => sum + u.credits, 0);

    return (
        <main className="min-h-screen flex items-start justify-center px-3 py-8 sm:px-4 sm:py-16">
            <div className="w-full max-w-5xl">

                {/* Header Bar */}
                <div className="admin-header animate-fade-in">
                    <div className="flex items-center gap-4 min-w-0">
                        <AnimatedLogo sizeClassName="h-20 w-20 flex-shrink-0" imageClassName="h-16 w-16" />
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-extrabold gradient-text tracking-tight">
                                Admin Panel
                            </h1>
                            <p className="text-xs text-gray-500 mt-0.5">
                                Manage users & credits
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => router.push("/")}
                        className="admin-back-btn"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 12H5" />
                            <polyline points="12 19 5 12 12 5" />
                        </svg>
                        Back to Studio
                    </button>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 xl:grid-cols-3 animate-fade-in-up" style={{ animationDelay: "80ms" }}>
                    <div className="admin-stat-card">
                        <div className="admin-stat-icon admin-stat-icon-users">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                        </div>
                        <div>
                            <p className="admin-stat-label">Total Users</p>
                            <p className="admin-stat-value">{users.length}</p>
                        </div>
                    </div>

                    <div className="admin-stat-card">
                        <div className="admin-stat-icon admin-stat-icon-credits">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                                <path d="M12 18V6" />
                            </svg>
                        </div>
                        <div>
                            <p className="admin-stat-label">Total Credits</p>
                            <p className="admin-stat-value">{parseFloat(totalCredits.toFixed(2))}</p>
                        </div>
                    </div>

                    <div className="admin-stat-card">
                        <div className="admin-stat-icon admin-stat-icon-avg">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="20" x2="18" y2="10" />
                                <line x1="12" y1="20" x2="12" y2="4" />
                                <line x1="6" y1="20" x2="6" y2="14" />
                            </svg>
                        </div>
                        <div>
                            <p className="admin-stat-label">Avg / User</p>
                            <p className="admin-stat-value">
                                {users.length > 0 ? (totalCredits / users.length).toFixed(1) : "0"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="admin-search-wrapper mb-5 animate-fade-in" style={{ animationDelay: "160ms" }}>
                    <svg className="admin-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        className="admin-search-input"
                        placeholder="Search users by email or name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                        <button className="admin-search-clear" onClick={() => setSearch("")}>
                            ✕
                        </button>
                    )}
                </div>

                {/* Users Table */}
                <div className="glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: "240ms" }}>
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="auth-loader" />
                        </div>
                    ) : filteredUsers.length === 0 ? (
                        <div className="admin-empty-state">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="8" y1="12" x2="16" y2="12" />
                            </svg>
                            <p>{search ? "No users match your search" : "No users found"}</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="admin-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: "35%" }}>User</th>
                                        <th style={{ width: "30%" }}>Email</th>
                                        <th style={{ width: "15%" }}>Credits</th>
                                        <th style={{ width: "20%" }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredUsers.map((u, i) => (
                                        <tr key={u.uid} style={{ animationDelay: `${i * 40}ms` }}>
                                            <td>
                                                <div className="admin-user-cell">
                                                    <div className="admin-avatar">
                                                        {(u.displayName || u.email || "?").charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="admin-user-info">
                                                        <span className="admin-user-name">
                                                            {u.displayName || "Anonymous"}
                                                        </span>
                                                        <span className="admin-user-uid">
                                                            {u.uid.substring(0, 12)}…
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <span className="admin-email">{u.email || "—"}</span>
                                            </td>
                                            <td>
                                                <span className={`admin-credits-badge ${u.credits > 0 ? "admin-credits-positive" : "admin-credits-zero"}`}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <circle cx="12" cy="12" r="10" />
                                                        <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                                                        <path d="M12 18V6" />
                                                    </svg>
                                                    {parseFloat(u.credits.toFixed(2))}
                                                </span>
                                            </td>
                                            <td>
                                                <div className="admin-actions">
                                                    <button
                                                        onClick={() => handleDeductCredit(u.uid, u.credits)}
                                                        disabled={updating === u.uid || u.credits <= 0}
                                                        className="admin-action-btn admin-action-minus"
                                                        title="Remove 1 credit"
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <line x1="5" y1="12" x2="19" y2="12" />
                                                        </svg>
                                                    </button>
                                                    <button
                                                        onClick={() => handleAddCredit(u.uid)}
                                                        disabled={updating === u.uid}
                                                        className="admin-action-btn admin-action-plus"
                                                        title="Add 1 credit"
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <line x1="12" y1="5" x2="12" y2="19" />
                                                            <line x1="5" y1="12" x2="19" y2="12" />
                                                        </svg>
                                                    </button>
                                                    {updating === u.uid && (
                                                        <span className="admin-updating-badge">updating…</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Table Footer */}
                    {!loading && filteredUsers.length > 0 && (
                        <div className="admin-table-footer">
                            Showing {filteredUsers.length} of {users.length} user{users.length !== 1 ? "s" : ""}
                        </div>
                    )}
                </div>

                {/* ─── CREDIT CODES SECTION ─── */}
                <div className="mt-8 animate-fade-in-up" style={{ animationDelay: "320ms" }}>
                    <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
                        <div className="admin-stat-icon admin-stat-icon-credits" style={{ width: 36, height: 36 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="5" width="20" height="14" rx="2" />
                                <line x1="2" y1="10" x2="22" y2="10" />
                            </svg>
                        </div>
                        Credit Codes
                    </h2>

                    {/* Create Code Form */}
                    <div className="glass-card p-4 sm:p-5 mb-4">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Generate New Code</p>
                        <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-end">
                            <div className="flex-1 min-w-[140px]">
                                <label className="block text-xs text-gray-500 mb-1.5">Credits (1–10)</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={newCodeCredits}
                                    onChange={(e) => setNewCodeCredits(Math.min(10, Math.max(1, Number(e.target.value))))}
                                    className="glass-input w-full p-3 text-sm"
                                />
                            </div>
                            <div className="flex-1 min-w-[140px]">
                                <label className="block text-xs text-gray-500 mb-1.5">Max Claims</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={1000}
                                    value={newCodeMaxClaims}
                                    onChange={(e) => setNewCodeMaxClaims(Math.min(1000, Math.max(1, Number(e.target.value))))}
                                    className="glass-input w-full p-3 text-sm"
                                />
                            </div>
                            <button
                                onClick={handleCreateCode}
                                disabled={creatingCode}
                                className="btn-primary w-full sm:w-auto px-6 h-[46px] text-sm"
                            >
                                <span>{creatingCode ? "Creating..." : "Generate Code"}</span>
                            </button>
                        </div>
                        {codeCreated && (
                            <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-3 animate-fade-in">
                                <span className="text-green-400 text-sm font-semibold">✓ Code created:</span>
                                <code className="text-green-300 font-mono text-sm font-bold bg-green-500/10 px-3 py-1 rounded">{codeCreated}</code>
                            </div>
                        )}
                    </div>

                    {/* Codes List */}
                    <div className="glass-card overflow-hidden">
                        {codes.length === 0 ? (
                            <div className="admin-empty-state">
                                <p>No credit codes created yet.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="admin-table">
                                    <thead>
                                        <tr>
                                            <th>Code</th>
                                            <th>Credits</th>
                                            <th>Claims</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {codes.map((c) => {
                                            const exhausted = c.claimedCount >= c.maxClaims;
                                            return (
                                                <tr key={c.code}>
                                                    <td>
                                                        <code className="font-mono text-sm font-bold text-white">{c.code}</code>
                                                    </td>
                                                    <td>
                                                        <span className="admin-credits-badge admin-credits-positive">
                                                            {parseFloat(c.credits.toFixed(2))}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className="text-sm text-gray-400">
                                                            {c.claimedCount} / {c.maxClaims}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className={`code-status-badge ${exhausted ? "code-status-expired" : "code-status-active"}`}>
                                                            {exhausted ? "Expired" : "Active"}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-[11px] text-gray-600 mt-8">
                    Powered by Vibecraft
                </p>
            </div>
        </main>
    );
}
