"use client";

import { useState } from "react";
import { UISchemaItem } from "../types";

interface ReviewCardProps {
    outputType: string;
    fields: Record<string, UISchemaItem>;
    onFieldChange: (key: string, value: string) => void;
}

const typeConfig: Record<string, { icon: string; accent: string; border: string; accentBg: string }> = {
    caption: { icon: "📝", accent: "text-blue-400", border: "border-blue-500/20", accentBg: "bg-blue-500/10" },
    image: { icon: "🎨", accent: "text-purple-400", border: "border-purple-500/20", accentBg: "bg-purple-500/10" },
};

export default function ReviewCard({ outputType, fields, onFieldChange }: ReviewCardProps) {
    const [showSuggestions, setShowSuggestions] = useState(false);
    const cfg = typeConfig[outputType] || { icon: "📦", accent: "text-gray-400", border: "border-white/10", accentBg: "bg-white/5" };

    // Split fields into obligatory and AI suggestions
    const obligatoryFields = Object.entries(fields).filter(
        ([, item]) => item.category === "obligatory" || !item.category
    );
    const suggestionFields = Object.entries(fields).filter(
        ([, item]) => item.category === "ai_suggestion"
    );

    return (
        <div className={`glass-surface p-5 ${cfg.border} animate-fade-in-up`}>
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-5">
                <span className="text-lg">{cfg.icon}</span>
                <h3 className={`text-sm font-bold uppercase tracking-wider ${cfg.accent}`}>
                    {outputType} Settings
                </h3>
                <div className="flex-1 h-px bg-white/5 ml-2" />
            </div>

            {/* Obligatory Fields — always visible */}
            {obligatoryFields.length > 0 && (
                <div className="mb-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                        {obligatoryFields.map(([key, item]) => (
                            <div key={key}>
                                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                                    {item.label}
                                </label>
                                <select
                                    className="dark-select w-full text-sm"
                                    value={item.value || ""}
                                    onChange={(e) => onFieldChange(key, e.target.value)}
                                >
                                    {item.options.map((opt) => (
                                        <option key={opt} value={opt}>
                                            {opt}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* AI Suggestions — collapsible */}
            {suggestionFields.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowSuggestions(!showSuggestions)}
                        className={`
              w-full flex items-center justify-between gap-2 p-3 rounded-lg
              transition-all duration-300 cursor-pointer group
              ${showSuggestions
                                ? `${cfg.accentBg} border ${cfg.border}`
                                : "bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04]"
                            }
            `}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-xs">✨</span>
                            <span className={`text-xs font-semibold ${showSuggestions ? cfg.accent : "text-gray-500 group-hover:text-gray-400"}`}>
                                AI Suggestions
                            </span>
                            <span className="text-[10px] text-gray-600 bg-white/5 px-1.5 py-0.5 rounded-full">
                                {suggestionFields.length}
                            </span>
                        </div>
                        <svg
                            className={`w-3.5 h-3.5 transition-transform duration-300 
                ${showSuggestions ? "rotate-180" : "rotate-0"}
                ${showSuggestions ? cfg.accent : "text-gray-600"}
              `}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                        </svg>
                    </button>

                    <div
                        className={`
              grid transition-all duration-400 ease-in-out overflow-hidden
              ${showSuggestions ? "grid-rows-[1fr] opacity-100 mt-4" : "grid-rows-[0fr] opacity-0 mt-0"}
            `}
                    >
                        <div className="min-h-0">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                                {suggestionFields.map(([key, item]) => (
                                    <div key={key} className="animate-fade-in">
                                        <label className="block text-xs font-medium text-gray-500 mb-1.5">
                                            {item.label}
                                        </label>
                                        <select
                                            className="dark-select w-full text-sm"
                                            value={item.value || ""}
                                            onChange={(e) => onFieldChange(key, e.target.value)}
                                        >
                                            {item.options.map((opt) => (
                                                <option key={opt} value={opt}>
                                                    {opt}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
