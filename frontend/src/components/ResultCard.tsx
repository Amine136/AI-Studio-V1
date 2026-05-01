"use client";

import { useState } from "react";
import InteractiveAuthenticatedImage from "./InteractiveAuthenticatedImage";

interface ResultCardProps {
    type: "caption" | "image";
    content: string;
    model: string;
}

export default function ResultCard({ type, content, model }: ResultCardProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (type === "caption") {
        return (
            <div className="animate-fade-in-up space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="font-bold text-white flex items-center gap-2">
                        📝 Caption
                        <span className="text-[10px] font-medium text-gray-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                            {model}
                        </span>
                    </h4>
                    <button
                        onClick={handleCopy}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-200
              bg-white/5 border border-white/10 hover:bg-white/8 hover:border-white/15
              text-gray-400 hover:text-white"
                    >
                        {copied ? "✓ Copied!" : "Copy"}
                    </button>
                </div>
                <div className="p-5 glass-surface whitespace-pre-wrap text-sm leading-relaxed text-gray-300
          max-h-[400px] overflow-y-auto">
                    {content}
                </div>
            </div>
        );
    }

    // Image result
    const isUrl = content.startsWith("http");

    return (
        <div className="animate-fade-in-up space-y-3">
            <h4 className="font-bold text-white flex items-center gap-2">
                🎨 Image
                <span className="text-[10px] font-medium text-gray-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                    {model}
                </span>
            </h4>
            {isUrl ? (
                <InteractiveAuthenticatedImage
                    src={content}
                    alt="AI Generated"
                    wrapperClassName="rounded-xl border border-white/10"
                    imageClassName="w-full object-cover"
                    loadingClassName="flex min-h-64 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-xs text-white/60"
                    errorClassName="flex min-h-64 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-xs text-white/60"
                />
            ) : (
                <div className="p-4 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm">
                    {content}
                </div>
            )}
        </div>
    );
}
