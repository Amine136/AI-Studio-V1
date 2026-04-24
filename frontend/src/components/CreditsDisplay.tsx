"use client";

import Link from "next/link";
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
    onSuspensionDetected?: (message: string) => void;
}

const CreditsDisplay = forwardRef<CreditsDisplayHandle, CreditsDisplayProps>(
    function CreditsDisplay({ uid, onCreditsChange, onSuspensionDetected }, ref) {
        const redeemCooldownStorageKey = `vibecraft:redeemCooldownUntil:${uid}`;
        const [credits, setCredits] = useState<number | null>(null);
        const [profileError, setProfileError] = useState<string | null>(null);
        const [codeInput, setCodeInput] = useState("");
        const [codeMessage, setCodeMessage] = useState<{ text: string; success: boolean; credits?: number; showPolicyLink?: boolean } | null>(null);
        const [redeeming, setRedeeming] = useState(false);
        const [showCodeInput, setShowCodeInput] = useState(false);
        const [redeemBlockedUntil, setRedeemBlockedUntil] = useState<number | null>(null);

        const fetchCredits = useCallback(async () => {
            try {
                const c = await getCredits(uid);
                setCredits(c);
                setProfileError(null);
                onCreditsChange?.(c);
            } catch (error) {
                const message = error instanceof Error && error.message
                    ? error.message
                    : "Could not load your credit balance.";
                setCredits(0);
                setProfileError(message);
                onCreditsChange?.(null);
            }
        }, [uid, onCreditsChange]);

        useImperativeHandle(ref, () => ({
            refresh: fetchCredits,
            getBalance: () => credits,
        }), [fetchCredits, credits]);

        useEffect(() => {
            fetchCredits();
        }, [fetchCredits]);

        useEffect(() => {
            if (typeof window === "undefined") return;
            const raw = window.localStorage.getItem(redeemCooldownStorageKey);
            if (!raw) return;
            const parsed = Number(raw);
            if (!Number.isFinite(parsed) || parsed <= Date.now()) {
                window.localStorage.removeItem(redeemCooldownStorageKey);
                return;
            }
            setRedeemBlockedUntil(parsed);
        }, [redeemCooldownStorageKey]);

        const shouldShowPolicyLink = (message: string) =>
            /usage policy|failed credit code attempts|failed credit-code attempts|suspended/i.test(message);

        const isRedeemCooldownMessage = (message: string) =>
            /reached 5 failed credit code attempts in 5 minutes/i.test(message);

        const activateRedeemCooldown = useCallback((message: string) => {
            const blockedUntil = Date.now() + (5 * 60 * 1000);
            setRedeemBlockedUntil(blockedUntil);
            if (typeof window !== "undefined") {
                window.localStorage.setItem(redeemCooldownStorageKey, String(blockedUntil));
            }
            setCodeMessage({
                text: message,
                success: false,
                showPolicyLink: true,
            });
        }, [redeemCooldownStorageKey]);

        useEffect(() => {
            if (!redeemBlockedUntil) return;
            if (redeemBlockedUntil <= Date.now()) {
                setRedeemBlockedUntil(null);
                if (typeof window !== "undefined") {
                    window.localStorage.removeItem(redeemCooldownStorageKey);
                }
                return;
            }

            const timeout = window.setTimeout(() => {
                setRedeemBlockedUntil(null);
                if (typeof window !== "undefined") {
                    window.localStorage.removeItem(redeemCooldownStorageKey);
                }
            }, redeemBlockedUntil - Date.now());

            return () => window.clearTimeout(timeout);
        }, [redeemBlockedUntil, redeemCooldownStorageKey]);

        const handleRedeem = async () => {
            if (!codeInput.trim()) return;
            if (redeemBlockedUntil && redeemBlockedUntil > Date.now()) {
                setCodeMessage({
                    text: "This account reached 5 failed credit code attempts in 5 minutes. Please wait about 5 minutes before trying again and review the usage policy.",
                    success: false,
                    showPolicyLink: true,
                });
                return;
            }
            setRedeeming(true);
            setCodeMessage(null);
            try {
                const result = await redeemCode(codeInput, uid);
                // Extract credits number from message for the success animation
                const creditsMatch = result.message.match(/\+(\d+)/);
                const creditsAdded = creditsMatch ? parseInt(creditsMatch[1]) : undefined;
                setCodeMessage({
                    text: result.message,
                    success: result.success,
                    credits: creditsAdded,
                    showPolicyLink: !result.success && shouldShowPolicyLink(result.message),
                });
                if (!result.success && /suspended/i.test(result.message)) {
                    onSuspensionDetected?.(`Your account is suspended: ${result.message}`);
                    return;
                }
                if (!result.success && isRedeemCooldownMessage(result.message)) {
                    activateRedeemCooldown(result.message);
                    return;
                }
                if (result.success) {
                    setCodeInput("");
                    setRedeemBlockedUntil(null);
                    if (typeof window !== "undefined") {
                        window.localStorage.removeItem(redeemCooldownStorageKey);
                    }
                    await fetchCredits();
                    // Auto-collapse after success
                    setTimeout(() => {
                        setShowCodeInput(false);
                        setCodeMessage(null);
                    }, 4000);
                } else {
                    if (!shouldShowPolicyLink(result.message)) {
                        setTimeout(() => setCodeMessage(null), 5000);
                    }
                }
            } catch (error) {
                const message = error instanceof Error && error.message
                    ? error.message
                    : "Could not redeem this code right now.";
                setCodeMessage({ text: message, success: false, showPolicyLink: shouldShowPolicyLink(message) });
                if (/your account is suspended|account is suspended|suspended/i.test(message)) {
                    onSuspensionDetected?.(message.startsWith("Your account is suspended") ? message : `Your account is suspended: ${message}`);
                    return;
                }
                if (isRedeemCooldownMessage(message)) {
                    activateRedeemCooldown(message);
                    return;
                }
                if (!shouldShowPolicyLink(message)) {
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
                        disabled={Boolean(profileError)}
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

                {profileError && (
                    <div className="redeem-result redeem-result-error animate-scale-in">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        <span>{profileError}</span>
                    </div>
                )}

                {/* Code Redemption Panel */}
                {showCodeInput && !profileError && (
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
                                disabled={Boolean(redeemBlockedUntil && redeemBlockedUntil > Date.now())}
                                autoFocus
                            />
                            <button
                                onClick={handleRedeem}
                                disabled={redeeming || !codeInput.trim() || Boolean(redeemBlockedUntil && redeemBlockedUntil > Date.now())}
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
                                        <div className="flex min-w-0 flex-col gap-2">
                                            <span>{codeMessage.text}</span>
                                            {codeMessage.showPolicyLink ? (
                                                <Link href="/policy" className="text-xs text-slate-300 underline underline-offset-4 transition-colors hover:text-white">
                                                    View usage policy
                                                </Link>
                                            ) : null}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="mt-4 flex justify-end">
                            <Link href="/policy" className="text-xs text-slate-500 transition-colors hover:text-slate-300">
                                View usage policy
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        );
    });

export default CreditsDisplay;
