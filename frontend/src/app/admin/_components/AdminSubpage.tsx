"use client";

import { type ReactNode } from "react";
import { useRouter } from "next/navigation";

type AdminSubpageProps = {
    title: string;
    description: string;
    children: ReactNode;
};

export default function AdminSubpage({ title, description, children }: AdminSubpageProps) {
    const router = useRouter();

    return (
        <main className="flex-1 overflow-y-auto p-6 custom-scrollbar relative">
            <div className="max-w-[1440px] mx-auto space-y-6">
                <div className="glass-panel p-6 rounded-xl border-b border-outline-variant mb-6">
                    <div className="flex items-center gap-4 min-w-0">
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-extrabold text-primary tracking-tight">
                                {title}
                            </h1>
                            <p className="text-xs text-on-surface-variant mt-1">{description}</p>
                        </div>
                    </div>
                </div>

                {children}
            </div>
        </main>
    );
}
