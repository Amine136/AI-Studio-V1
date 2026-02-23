"use client";

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { getCredits, addCredits, deductCredits } from "../lib/credits";

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
        const [loading, setLoading] = useState(false);

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

        const handleAdd = async () => {
            setLoading(true);
            try {
                await addCredits(uid, 1);
                await fetchCredits();
            } finally {
                setLoading(false);
            }
        };

        const handleDeduct = async () => {
            setLoading(true);
            try {
                const success = await deductCredits(uid, 1);
                if (!success) {
                    // Not enough credits — could show a toast, for now just refresh
                }
                await fetchCredits();
            } finally {
                setLoading(false);
            }
        };

        if (credits === null) {
            return (
                <div className="credits-widget">
                    <div className="credits-shimmer" />
                </div>
            );
        }

        return (
            <div className="credits-widget">
                <div className="credits-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                        <path d="M12 18V6" />
                    </svg>
                    Credits
                </div>
                <div className="credits-controls">
                    <button
                        onClick={handleDeduct}
                        disabled={loading || credits <= 0}
                        className="credits-btn credits-btn-minus"
                        title="Remove credit"
                    >
                        −
                    </button>
                    <span className="credits-value">{credits}</span>
                    <button
                        onClick={handleAdd}
                        disabled={loading}
                        className="credits-btn credits-btn-plus"
                        title="Add credit"
                    >
                        +
                    </button>
                </div>
            </div>
        );
    });

export default CreditsDisplay;
