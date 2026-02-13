"use client";

import { OutputType } from "../types";

interface OutputToggleProps {
    type: OutputType;
    isSelected: boolean;
    onToggle: () => void;
}

const config = {
    caption: {
        icon: "📝",
        label: "Caption",
        description: "AI-generated text content",
        activeClasses: "border-blue-500/50 bg-blue-500/5 shadow-[0_0_20px_rgba(59,130,246,0.1)]",
        iconBg: "bg-blue-500/10",
    },
    image: {
        icon: "🎨",
        label: "Image",
        description: "AI-generated visuals",
        activeClasses: "border-purple-500/50 bg-purple-500/5 shadow-[0_0_20px_rgba(139,92,246,0.1)]",
        iconBg: "bg-purple-500/10",
    },
};

export default function OutputToggle({ type, isSelected, onToggle }: OutputToggleProps) {
    const c = config[type];

    return (
        <button
            onClick={onToggle}
            className={`
        flex-1 p-5 rounded-xl border transition-all duration-300 text-left
        group cursor-pointer
        ${isSelected
                    ? c.activeClasses
                    : "border-white/8 bg-white/2 hover:border-white/15 hover:bg-white/3"
                }
      `}
        >
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl
          transition-all duration-300
          ${isSelected ? c.iconBg : "bg-white/5"}`}
                >
                    {c.icon}
                </div>
                <div>
                    <div className={`font-semibold text-sm transition-colors duration-300 ${isSelected ? "text-white" : "text-gray-400"
                        }`}>
                        {c.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{c.description}</div>
                </div>
            </div>

            {/* Active indicator dot */}
            <div className={`mt-3 flex justify-end transition-all duration-300 ${isSelected ? "opacity-100" : "opacity-0"}`}>
                <div className={`w-2 h-2 rounded-full ${type === "caption" ? "bg-blue-400" : "bg-purple-400"}`} />
            </div>
        </button>
    );
}
