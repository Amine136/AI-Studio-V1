"use client";

interface LoadingSpinnerProps {
    text?: string;
}

export default function LoadingSpinner({ text = "Processing..." }: LoadingSpinnerProps) {
    return (
        <div className="flex items-center justify-center gap-3">
            {/* Gradient spinning ring */}
            <div className="relative w-5 h-5">
                <div className="absolute inset-0 rounded-full border-2 border-white/10" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 border-r-purple-500 animate-spin" />
            </div>
            <span className="text-sm font-medium text-gray-300">{text}</span>
        </div>
    );
}
