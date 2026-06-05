"use client";

import { useEffect, useState } from "react";
import { api } from "../../../services/api";
import { AdminUserListItem } from "../../../types";

export default function FinancePage() {
    const [loading, setLoading] = useState(true);
    const [totalCredits, setTotalCredits] = useState(0);

    // Margin Calculator State
    const [providerCostUsd, setProviderCostUsd] = useState<number>(0.02);
    const [exchangeRate, setExchangeRate] = useState<number>(3.25);
    const [penaltyLevel, setPenaltyLevel] = useState<"low" | "medium" | "high">("low");

    // Balance Monitor State
    const [balances, setBalances] = useState<{ id: string, name: string, balance: number }[]>([
        { id: "1", name: "Groq", balance: 45 },
        { id: "2", name: "OpenAI", balance: 120 },
        { id: "3", name: "Google Gemini", balance: 75 }
    ]);

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await api.getAdminUsers({ limit: 5000 });
                const users = res.users ?? [];
                const sum = users.reduce((acc: number, item: AdminUserListItem) => acc + (item.totalCredits || item.credits || 0), 0);
                setTotalCredits(sum);
            } catch (err) {
                console.error("Failed to load users for credits", err);
            } finally {
                setLoading(false);
            }
        };
        fetchUsers();
    }, []);

    // Derived Margin
    const costCredits = providerCostUsd * exchangeRate;
    let baseRetailPrice = costCredits / 0.40; // 40% margin target
    const penaltyAmount = penaltyLevel === "low" ? 0 : penaltyLevel === "medium" ? 0.1 : 0.2;
    const retailPrice = baseRetailPrice + penaltyAmount;
    const hostingAds = baseRetailPrice * 0.20;
    const pureProfit = (baseRetailPrice * 0.40) + penaltyAmount;

    // Derived Balance Reserve
    const requiredReserve = totalCredits * 0.40;

    const getStatusInfo = (balance: number) => {
        if (balance < 50) return { label: "Danger", color: "text-error", bg: "bg-error/10 border-error/20" };
        if (balance < 100) return { label: "Partially Safe", color: "text-warning", bg: "bg-warning/10 border-warning/20" };
        return { label: "Safe", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/20" };
    };

    const updateBalance = (id: string, newBalance: number) => {
        setBalances(prev => prev.map(b => b.id === id ? { ...b, balance: newBalance } : b));
    };

    const addProvider = () => {
        setBalances([...balances, { id: Date.now().toString(), name: "New Provider", balance: 0 }]);
    };

    const removeProvider = (id: string) => {
        setBalances(balances.filter(b => b.id !== id));
    };

    return (
        <main className="flex-1 overflow-y-auto p-6 custom-scrollbar relative">
            <div className="max-w-[1200px] mx-auto space-y-8">
                <div>
                    <h1 className="font-headline-md text-headline-md text-on-surface">Finance & Profitability</h1>
                    <p className="font-body-md text-on-surface-variant mt-1">Calculate margins and monitor API account health.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Margin Calculator */}
                    <div className="glass-panel p-8 rounded-lg flex flex-col relative overflow-hidden group">
                        <div className="absolute -right-10 -top-10 w-40 h-40 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
                        <h2 className="font-title-lg text-title-lg text-on-surface flex items-center gap-2 mb-6">
                            <span className="material-symbols-outlined text-primary">calculate</span>
                            Margin Calculator
                        </h2>

                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block font-label-caps text-[11px] text-on-surface-variant mb-2">Provider Cost (USD)</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant font-bold">$</span>
                                        <input 
                                            type="number" 
                                            value={providerCostUsd}
                                            onChange={(e) => setProviderCostUsd(Number(e.target.value))}
                                            className="w-full bg-surface-container-high border border-outline-variant rounded-lg py-2 pl-8 pr-4 text-on-surface focus:outline-none focus:border-primary transition-colors"
                                            step="0.001"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block font-label-caps text-[11px] text-on-surface-variant mb-2">Exchange Rate (USD to Credits)</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant font-bold">CR</span>
                                        <input 
                                            type="number" 
                                            value={exchangeRate}
                                            onChange={(e) => setExchangeRate(Number(e.target.value))}
                                            className="w-full bg-surface-container-high border border-outline-variant rounded-lg py-2 pl-10 pr-4 text-on-surface focus:outline-none focus:border-primary transition-colors"
                                            step="0.01"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block font-label-caps text-[11px] text-on-surface-variant mb-2">Rate Limit Penalty</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                            type="radio" 
                                            name="penalty" 
                                            value="low" 
                                            checked={penaltyLevel === "low"} 
                                            onChange={(e) => setPenaltyLevel("low")}
                                            className="accent-primary"
                                        />
                                        <span className="text-sm text-on-surface">Low (+0 CR)</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                            type="radio" 
                                            name="penalty" 
                                            value="medium" 
                                            checked={penaltyLevel === "medium"} 
                                            onChange={(e) => setPenaltyLevel("medium")}
                                            className="accent-primary"
                                        />
                                        <span className="text-sm text-on-surface">Medium (+0.1 CR)</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                            type="radio" 
                                            name="penalty" 
                                            value="high" 
                                            checked={penaltyLevel === "high"} 
                                            onChange={(e) => setPenaltyLevel("high")}
                                            className="accent-primary"
                                        />
                                        <span className="text-sm text-on-surface">High (+0.2 CR)</span>
                                    </label>
                                </div>
                            </div>

                            <div className="p-6 bg-surface-container-highest border border-outline-variant rounded-xl mt-6">
                                <div className="flex justify-between items-end mb-6">
                                    <div>
                                        <p className="font-label-caps text-[11px] text-on-surface-variant mb-1">Recommended Retail Price</p>
                                        <div className="flex items-baseline gap-1">
                                            <span className="font-headline-lg text-3xl font-bold text-primary">{retailPrice.toFixed(3)}</span>
                                            <span className="text-on-surface-variant text-sm font-bold">CR</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-label-caps text-[11px] text-on-surface-variant mb-1">Base Cost</p>
                                        <p className="font-code-sm text-sm text-on-surface">{costCredits.toFixed(3)} CR</p>
                                    </div>
                                </div>

                                <div className="space-y-3 pt-4 border-t border-outline-variant/50">
                                    <div className="flex justify-between items-center text-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-secondary"></div>
                                            <span className="text-on-surface-variant">API Cost (40%)</span>
                                        </div>
                                        <span className="font-code-sm font-bold text-on-surface">{costCredits.toFixed(3)} CR</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-tertiary"></div>
                                            <span className="text-on-surface-variant">Hosting & Ads (20%)</span>
                                        </div>
                                        <span className="font-code-sm font-bold text-on-surface">{hostingAds.toFixed(3)} CR</span>
                                    </div>
                                    <div className="flex justify-between items-center text-sm">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                                            <span className="text-on-surface-variant">Pure Profit (40% + Penalty)</span>
                                        </div>
                                        <span className="font-code-sm font-bold text-emerald-400">+{pureProfit.toFixed(3)} CR</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Balance Monitor */}
                    <div className="glass-panel p-8 rounded-lg flex flex-col relative overflow-hidden group">
                        <div className="absolute -right-10 -top-10 w-40 h-40 bg-secondary/5 rounded-full blur-3xl pointer-events-none"></div>
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="font-title-lg text-title-lg text-on-surface flex items-center gap-2">
                                <span className="material-symbols-outlined text-secondary">monitoring</span>
                                API Account Health
                            </h2>
                            <button onClick={addProvider} className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center hover:bg-surface-bright transition-colors">
                                <span className="material-symbols-outlined text-[18px]">add</span>
                            </button>
                        </div>

                        <div className="flex items-center gap-4 p-4 bg-primary/5 border border-primary/20 rounded-lg mb-6">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                                <span className="material-symbols-outlined">group</span>
                            </div>
                            <div>
                                <p className="font-label-caps text-[10px] text-on-surface-variant">Total User Credits in Circulation</p>
                                <p className="font-headline-sm text-on-surface font-bold">
                                    {loading ? "..." : totalCredits.toFixed(2)} CR 
                                    <span className="text-xs text-on-surface-variant font-normal ml-2">(Est. Liability: {requiredReserve.toFixed(2)} API Value)</span>
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                            {balances.map(b => {
                                const status = getStatusInfo(b.balance);
                                return (
                                    <div key={b.id} className={`flex items-center justify-between p-4 rounded-lg border ${status.bg} transition-colors`}>
                                        <div className="flex-1">
                                            <input 
                                                type="text" 
                                                value={b.name}
                                                onChange={(e) => setBalances(balances.map(item => item.id === b.id ? { ...item, name: e.target.value } : item))}
                                                className="bg-transparent border-none focus:outline-none font-bold text-on-surface w-full mb-1"
                                                placeholder="Provider Name"
                                            />
                                            <span className={`font-label-caps text-[10px] uppercase font-bold flex items-center gap-1 ${status.color}`}>
                                                <span className="material-symbols-outlined text-[12px]">
                                                    {b.balance < 50 ? 'warning' : b.balance < 100 ? 'info' : 'check_circle'}
                                                </span>
                                                {status.label}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="relative w-24">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant font-bold text-sm">$</span>
                                                <input 
                                                    type="number" 
                                                    value={b.balance}
                                                    onChange={(e) => updateBalance(b.id, Number(e.target.value))}
                                                    className="w-full bg-surface/50 border border-outline-variant/50 rounded pl-7 pr-2 py-1 text-right font-code-sm text-sm focus:outline-none focus:border-primary"
                                                />
                                            </div>
                                            <button onClick={() => removeProvider(b.id)} className="text-on-surface-variant hover:text-error transition-colors">
                                                <span className="material-symbols-outlined text-[18px]">close</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-xs text-on-surface-variant mt-6 italic">* Balances are saved locally to this session for estimation.</p>
                    </div>
                </div>
            </div>
        </main>
    );
}
