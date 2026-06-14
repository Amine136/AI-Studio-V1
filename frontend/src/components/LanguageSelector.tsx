"use client";

import { useLanguage } from "../context/LanguageContext";

export default function LanguageSelector() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-[#0c1324]/80 p-1 backdrop-blur-md">
      {(
        [
          { id: "en", label: "EN" },
          { id: "fr", label: "FR" },
          { id: "ar", label: "AR" },
        ] as const
      ).map((lang) => (
        <button
          key={lang.id}
          onClick={() => setLanguage(lang.id)}
          className={`flex h-6 w-8 sm:h-8 sm:w-10 items-center justify-center rounded-full text-[10px] sm:text-xs font-bold transition-all duration-300 ${
            language === lang.id
              ? "bg-[#3b82f6] text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]"
              : "text-[#64748b] hover:text-[#f8fafc]"
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
