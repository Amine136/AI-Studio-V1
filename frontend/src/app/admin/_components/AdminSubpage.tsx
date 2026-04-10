"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AnimatedLogo from "../../../components/AnimatedLogo";
import { useAuth } from "../../../context/AuthContext";
import { api } from "../../../services/api";

type AdminSubpageProps = {
    title: string;
    description: string;
    children: ReactNode;
};

export default function AdminSubpage({ title, description, children }: AdminSubpageProps) {
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();
    const [authorized, setAuthorized] = useState<boolean | null>(null);
    const [loadError, setLoadError] = useState("");

    useEffect(() => {
        if (!authLoading && !user) {
            router.replace("/auth");
        }
    }, [authLoading, router, user]);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;

        const loadProfile = async () => {
            try {
                const profile = await api.getProfile();
                if (!cancelled) {
                    setAuthorized(profile.isAdmin);
                }
            } catch (error) {
                if (!cancelled) {
                    setLoadError(error instanceof Error ? error.message : "Unable to verify admin access.");
                }
            }
        };

        void loadProfile();

        return () => {
            cancelled = true;
        };
    }, [user]);

    if (authLoading || !user || authorized === null) {
        if (!authLoading && user && loadError) {
            return (
                <main className="min-h-screen flex items-center justify-center px-4">
                    <div className="glass-card p-8 max-w-md w-full text-center">
                        <h1 className="text-2xl font-extrabold gradient-text">Admin Access</h1>
                        <p className="text-sm text-gray-400 mt-3">
                            Unable to verify admin access right now.
                        </p>
                        <p className="mt-2 text-sm text-amber-300">{loadError}</p>
                        <button onClick={() => window.location.reload()} className="btn-primary mt-6 w-full">
                            <span>Retry</span>
                        </button>
                    </div>
                </main>
            );
        }
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
                        Your account is not authorized to access this page.
                    </p>
                    <button onClick={() => router.push("/")} className="btn-primary mt-6 w-full">
                        <span>Back to Studio</span>
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen flex items-start justify-center px-3 py-8 sm:px-4 sm:py-16">
            <div className="w-full max-w-6xl">
                <div className="admin-header animate-fade-in">
                    <div className="flex items-center gap-4 min-w-0">
                        <AnimatedLogo sizeClassName="h-20 w-20 flex-shrink-0" imageClassName="h-16 w-16" />
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-extrabold gradient-text tracking-tight">
                                {title}
                            </h1>
                            <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => router.push("/admin")} className="btn-secondary px-4 py-2 text-sm">
                            Overview
                        </button>
                        <button onClick={() => router.push("/")} className="admin-back-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 12H5" />
                                <polyline points="12 19 5 12 12 5" />
                            </svg>
                            Back to Studio
                        </button>
                    </div>
                </div>

                {children}
            </div>
        </main>
    );
}
