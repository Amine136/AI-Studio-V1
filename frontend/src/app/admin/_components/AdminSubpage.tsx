"use client";

import { type ReactNode } from "react";
import { useRouter } from "next/navigation";

import AnimatedLogo from "../../../components/AnimatedLogo";
import { api } from "../../../services/api";
import { useAdminSession } from "./useAdminSession";

type AdminSubpageProps = {
    title: string;
    description: string;
    children: ReactNode;
};

export default function AdminSubpage({ title, description, children }: AdminSubpageProps) {
    const router = useRouter();
    const { session, loading, error } = useAdminSession();

    if (loading || !session) {
        if (!loading && error) {
            return (
                <main className="min-h-screen flex items-center justify-center px-4">
                    <div className="glass-card p-8 max-w-md w-full text-center">
                        <h1 className="text-2xl font-extrabold gradient-text">Admin Access</h1>
                        <p className="text-sm text-gray-400 mt-3">
                            Unable to verify admin access right now.
                        </p>
                        <p className="mt-2 text-sm text-amber-300">{error}</p>
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
                        <button onClick={() => router.push("/")} className="btn-secondary px-4 py-2 text-sm">
                            Overview
                        </button>
                        <button onClick={() => router.push("/news")} className="btn-secondary px-4 py-2 text-sm">
                            News
                        </button>
                        <button onClick={() => router.push("/models")} className="btn-secondary px-4 py-2 text-sm">
                            Models
                        </button>
                        <button onClick={() => router.push("/warnings")} className="btn-secondary px-4 py-2 text-sm">
                            Warnings
                        </button>
                        <button
                            onClick={async () => {
                                await api.adminLogout();
                                window.location.href = "/login";
                            }}
                            className="btn-secondary px-4 py-2 text-sm"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>

                {children}
            </div>
        </main>
    );
}
