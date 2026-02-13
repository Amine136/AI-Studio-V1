"use client";

import { useState } from "react";

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
                <div className="group relative rounded-xl overflow-hidden border border-white/10">
                    <img
                        src={content}
                        alt="AI Generated"
                        className="w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent
            opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <a
                        href={content}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute bottom-4 right-4 bg-white/10 backdrop-blur-md px-4 py-2 rounded-lg
              text-xs font-bold text-white border border-white/20
              opacity-0 group-hover:opacity-100 transition-all duration-300
              hover:bg-white/20"
                    >
                        Download HD ↗
                    </a>
                </div>
            ) : (
                <div className="p-4 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-sm">
                    {content}
                </div>
            )}
        </div>
    );
}
