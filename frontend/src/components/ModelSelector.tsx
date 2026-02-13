"use client";

interface ModelSelectorProps {
    label: string;
    models: string[];
    selected: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    accent?: "blue" | "purple";
}

export default function ModelSelector({
    label,
    models,
    selected,
    onChange,
    disabled = false,
    accent = "blue",
}: ModelSelectorProps) {
    return (
        <div className={`transition-all duration-300 ${disabled ? "opacity-25 pointer-events-none" : "opacity-100"}`}>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
                {label}
            </label>
            <select
                className={`dark-select w-full ${accent === "purple" ? "focus:border-purple-500/50 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.1)]" : ""
                    }`}
                value={selected}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
            >
                {models.map((m) => (
                    <option key={m} value={m}>
                        {m}
                    </option>
                ))}
            </select>
        </div>
    );
}
