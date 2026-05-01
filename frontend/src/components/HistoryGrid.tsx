"use client";

import { useState, useEffect, useCallback } from "react";
import { HistoryEntry } from "../lib/history";
import AuthenticatedImage from "./AuthenticatedImage";

const DEFAULT_VISIBLE_HISTORY_COUNT = 10;

function isRenderableImageUrl(value?: string): boolean {
    if (!value) return false;
    return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
}

interface HistoryGridProps {
    entries: HistoryEntry[];
    loading: boolean;
}

export default function HistoryGrid({ entries, loading }: HistoryGridProps) {
    const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        setShowAll(false);
    }, [entries]);

    if (loading) {
        return (
            <div className="mt-8">
                <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-sm">🕘</div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">Recent Generations</h3>
                    <div className="flex-1 h-px bg-white/5" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="aspect-square rounded-xl bg-white/[0.03] animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (entries.length === 0) return null;

    const visibleEntries = showAll ? entries : entries.slice(0, DEFAULT_VISIBLE_HISTORY_COUNT);
    const remainingCount = Math.max(entries.length - DEFAULT_VISIBLE_HISTORY_COUNT, 0);

    return (
        <div className="mt-8">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center text-sm">🕘</div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">Recent Generations</h3>
                <span className="text-[10px] text-gray-600 bg-white/5 px-2 py-0.5 rounded-full">{entries.length}</span>
                <div className="flex-1 h-px bg-white/5" />
            </div>

            {/* Image Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {visibleEntries.map((entry) => (
                    <button
                        key={entry.id}
                        onClick={() => setSelectedEntry(entry)}
                        className="group relative aspect-square rounded-xl overflow-hidden bg-white/[0.03] border border-white/5 hover:border-white/15 transition-all duration-300 cursor-pointer"
                    >
                        {isRenderableImageUrl(entry.imageUrl) ? (
                            <AuthenticatedImage
                                src={entry.imageUrl || ""}
                                alt={entry.prompt}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">📝</div>
                        )}
                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
                            <p className="text-[11px] text-white/90 line-clamp-2 leading-tight">{entry.prompt}</p>
                            <p className="text-[9px] text-white/50 mt-1">{entry.model}</p>
                        </div>
                    </button>
                ))}
            </div>

            {!showAll && remainingCount > 0 && (
                <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="btn-secondary mt-4 w-full"
                >
                    Show {remainingCount} More
                </button>
            )}

            {/* Detail Modal */}
            {selectedEntry && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
                    onClick={() => setSelectedEntry(null)}
                >
                    <div
                        className="glass-card max-w-2xl w-full max-h-[90vh] overflow-y-auto p-0 animate-fade-in-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {isRenderableImageUrl(selectedEntry.imageUrl) && (
                            <AuthenticatedImage
                                src={selectedEntry.imageUrl || ""}
                                alt={selectedEntry.prompt}
                                className="w-full rounded-t-2xl"
                            />
                        )}
                        <div className="p-5 space-y-3">
                            <div>
                                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Prompt</label>
                                <p className="text-sm text-gray-300 mt-1 leading-relaxed">{selectedEntry.prompt}</p>
                            </div>
                            {selectedEntry.caption && (
                                <div>
                                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Caption</label>
                                    <p className="text-sm text-gray-300 mt-1 leading-relaxed whitespace-pre-wrap">{selectedEntry.caption}</p>
                                </div>
                            )}
                            <div className="flex flex-col gap-3 pt-2 border-t border-white/5 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] text-gray-600 bg-white/5 px-2 py-0.5 rounded-full">{selectedEntry.model}</span>
                                    <span className="text-[10px] text-gray-600">
                                        {selectedEntry.createdAt.toLocaleDateString()} {selectedEntry.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                </div>
                                <button
                                    onClick={() => setSelectedEntry(null)}
                                    className="text-xs text-gray-500 hover:text-white transition-colors px-3 py-1 rounded-lg hover:bg-white/5 self-start sm:self-auto"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
