"use client";

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { getCredits } from "../lib/credits";
import { redeemCode } from "../lib/creditCodes";

export interface CreditsDisplayHandle {
    refresh: () => Promise<void>;
    getBalance: () => number | null;
}

interface CreditsDisplayProps {
    uid: string;
    onCreditsChange?: (credits: number | null) => void;
}

const CreditsDisplay = forwardRef<CreditsDisplayHandle, CreditsDisplayProps>(
    function CreditsDisplay({ uid, onCreditsChange }, ref) {
        const [credits, setCredits] = useState<number | null>(null);
        const [codeInput, setCodeInput] = useState("");
        const [codeMessage, setCodeMessage] = useState<{ text: string; success: boolean; credits?: number } | null>(null);
        const [redeeming, setRedeeming] = useState(false);
        const [showCodeInput, setShowCodeInput] = useState(false);

        const fetchCredits = useCallback(async () => {
            const c = await getCredits(uid);
            setCredits(c);
            onCreditsChange?.(c);
        }, [uid, onCreditsChange]);

        useImperativeHandle(ref, () => ({
            refresh: fetchCredits,
            getBalance: () => credits,
        }), [fetchCredits, credits]);

        useEffect(() => {
            fetchCredits();
        }, [fetchCredits]);

        const handleRedeem = async () => {
            if (!codeInput.trim()) return;
            setRedeeming(true);
            setCodeMessage(null);
            try {
                const result = await redeemCode(codeInput, uid);
                // Extract credits number from message for the success animation
                const creditsMatch = result.message.match(/\+(\d+)/);
                const creditsAdded = creditsMatch ? parseInt(creditsMatch[1]) : undefined;
                setCodeMessage({ text: result.message, success: result.success, credits: creditsAdded });
                if (result.success) {
                    setCodeInput("");
                    await fetchCredits();
                    // Auto-collapse after success
                    setTimeout(() => {
                        setShowCodeInput(false);
                        setCodeMessage(null);
                    }, 4000);
                } else {
                    setTimeout(() => setCodeMessage(null), 5000);
                }
            } finally {
                setRedeeming(false);
            }
        };

        if (credits === null) {
            return (
                <div className="credits-container">
                    <div className="credits-widget">
                        <div className="credits-shimmer" />
                    </div>
                </div>
            );
        }

        return (
            <div className="credits-container">
                {/* Main Credits Bar */}
                <div className="credits-bar">
                    <div className="credits-info">
                        <div className="credits-icon-circle">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                                <path d="M12 18V6" />
                            </svg>
                        </div>
                        <div className="credits-text">
                            <span className="credits-count">{parseFloat(credits.toFixed(2))}</span>
                            <span className="credits-unit">Credit{credits !== 1 ? "s" : ""}</span>
                        </div>
                    </div>

                    <button
                        onClick={() => { setShowCodeInput(!showCodeInput); setCodeMessage(null); }}
                        className={`redeem-toggle-btn ${showCodeInput ? "redeem-toggle-active" : ""}`}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
                            <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
                            <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
                        </svg>
                        {showCodeInput ? "Close" : "Redeem Code"}
                    </button>
                </div>

                {/* Code Redemption Panel */}
                {showCodeInput && (
                    <div className="redeem-panel animate-fade-in">
                        <div className="redeem-panel-header">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 12 20 22 4 22 4 12" />
                                <rect x="2" y="7" width="20" height="5" />
                                <line x1="12" y1="22" x2="12" y2="7" />
                                <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                                <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                            </svg>
                            Enter your credit code
                        </div>
                        <div className="redeem-input-row">
                            <input
                                type="text"
                                className="redeem-input"
                                placeholder="VC-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                                value={codeInput}
                                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
                                maxLength={33}
                                autoFocus
                            />
                            <button
                                onClick={handleRedeem}
                                disabled={redeeming || !codeInput.trim()}
                                className="redeem-apply-btn"
                            >
                                {redeeming ? (
                                    <span className="auth-spinner" />
                                ) : (
                                    <>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                        Apply
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Result Message */}
                        {codeMessage && (
                            <div className={`redeem-result animate-scale-in ${codeMessage.success ? "redeem-result-success" : "redeem-result-error"}`}>
                                {codeMessage.success ? (
                                    <>
                                        <div className="redeem-success-icon">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12" />
                                            </svg>
                                        </div>
                                        <div className="redeem-success-text">
                                            <span className="redeem-success-title">Code Redeemed!</span>
                                            <span className="redeem-success-detail">{codeMessage.text}</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                                            <circle cx="12" cy="12" r="10" />
                                            <line x1="15" y1="9" x2="9" y2="15" />
                                            <line x1="9" y1="9" x2="15" y2="15" />
                                        </svg>
                                        <span>{codeMessage.text}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    });

export default CreditsDisplay;
