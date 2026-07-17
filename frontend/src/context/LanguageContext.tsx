"use client";

import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";
import { translations } from "../lib/translations";
import {
  DEFAULT_LANGUAGE,
  applyLanguageToDocument,
  persistLanguage,
  readStoredLanguage,
  type Language,
} from "../lib/language";

export type { Language };

interface LanguageContextProps {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  isRtl: boolean;
}

const LanguageContext = createContext<LanguageContextProps>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: (key: string) => key,
  isRtl: false,
});

// Runs before the browser paints, unlike useEffect. Only used for the one-time
// localStorage migration below, so a legacy visitor doesn't see a swapped word.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export const LanguageProvider = ({
  children,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  children: React.ReactNode;
  /* Read from the cookie by the server layout, so the HTML we hydrate is ALREADY
     in the right language. Starting from it is what makes the first paint correct
     and keeps hydration matching. */
  initialLanguage?: Language;
}) => {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useIsomorphicLayoutEffect(() => {
    // The server saw the cookie, so normally this agrees and nothing happens.
    // It only fires for a visitor who picked a language before the cookie existed
    // (localStorage only): readStoredLanguage() adopts it and writes the cookie,
    // so from their next load the server gets it right and this never runs again.
    const stored = readStoredLanguage();
    if (stored !== language) {
      setLanguageState(stored);
      applyLanguageToDocument(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    persistLanguage(lang);
    applyLanguageToDocument(lang);
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
