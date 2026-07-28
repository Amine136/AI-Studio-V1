"use client";

import { useLanguage } from "../context/LanguageContext";

interface StepIndicatorProps {
    currentStep: "INPUT" | "REVIEW" | "RESULT";
}

const steps = [
    { key: "INPUT", label: "Idea", icon: "✦" },
    { key: "REVIEW", label: "Optimize", icon: "◎" },
    { key: "RESULT", label: "Result", icon: "✓" },
] as const;

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
    const { t } = useLanguage();
    const currentIndex = steps.findIndex((s) => s.key === currentStep);

    return (
        <div className="flex items-center justify-center gap-0 mb-8 sm:mb-10 overflow-x-auto pb-1">
            {steps.map((step, i) => {
                const isActive = step.key === currentStep;
                const isCompleted = i < currentIndex;

                return (
                    <div key={step.key} className="flex items-center flex-shrink-0">
                        {/* Step circle + label */}
                        <div className="flex flex-col items-center gap-2">
                            <div
                                className={`
                  w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm font-bold
                  transition-all duration-300
                  ${isActive
                                        ? "bg-gradient-to-br from-blue-500 to-purple-500 text-white shadow-lg animate-pulse-glow"
                                        : isCompleted
                                            ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                            : "bg-white/5 text-gray-500 border border-white/10"
                                    }
                `}
                            >
                                {isCompleted ? "✓" : step.icon}
                            </div>
                            <span
                                className={`text-[11px] sm:text-xs font-medium tracking-wide transition-colors duration-300 ${isActive ? "text-white" : isCompleted ? "text-green-400" : "text-gray-500"
                                    }`}
                            >
                                {t(step.label)}
                            </span>
                        </div>

                        {/* Connector line. Logical inset so it fills from the
                            reading-start edge in Arabic too. */}
                        {i < steps.length - 1 && (
                            <div className="w-10 sm:w-24 h-px mx-2 sm:mx-3 mb-6 relative">
                                <div className="absolute inset-0 bg-white/10 rounded-full" />
                                <div
                                    className={`absolute inset-y-0 start-0 rounded-full transition-all duration-500 ${isCompleted ? "w-full bg-green-500/50" : "w-0"
                                        }`}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
