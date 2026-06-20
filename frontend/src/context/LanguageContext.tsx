"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { translations } from "../lib/translations";

export type Language = "en" | "fr" | "ar";

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  isRtl: boolean;
}

const LanguageContext = createContext<LanguageContextProps>({
  language: "en",
  setLanguage: () => {},
  t: (key: string) => key,
  isRtl: false,
});

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  // Arabic is the default language (primary audience). A returning visitor's
  // saved choice still wins on mount.
  const [language, setLanguageState] = useState<Language>("ar");

  useEffect(() => {
    const saved = localStorage.getItem("vibecraft_lang") as Language;
    const initial = saved && ["en", "fr", "ar"].includes(saved) ? saved : "ar";
    setLanguageState(initial);
    document.documentElement.dir = initial === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = initial;
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("vibecraft_lang", lang);
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  };

  const t = (key: string) => {
    // @ts-ignore
    return translations[language]?.[key] || translations["en"]?.[key] || key;
  };

  const isRtl = language === "ar";

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isRtl }}>
      <div dir={isRtl ? "rtl" : "ltr"} className={isRtl ? "font-sans-arabic" : ""}>
        {children}
      </div>
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
