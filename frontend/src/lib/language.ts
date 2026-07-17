export type Language = "en" | "fr" | "ar";

export const LANGUAGES: Language[] = ["en", "fr", "ar"];
export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_STORAGE_KEY = "vibecraft_lang";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as string[]).includes(value);

function readLanguageCookie(): Language | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${LANGUAGE_STORAGE_KEY}=([^;]*)`),
  );
  const value = match ? decodeURIComponent(match[1]) : null;
  return isLanguage(value) ? value : null;
}

/* Cookie first, then localStorage. The cookie is the one a server render can
   read, and it lets us migrate visitors who only ever had the localStorage key. */
export function readStoredLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;

  const fromCookie = readLanguageCookie();
  if (fromCookie) return fromCookie;

  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(saved)) {
      writeLanguageCookie(saved); // migrate, so the next load has it in the cookie too
      return saved;
    }
  } catch {
    /* private mode / storage disabled */
  }

  return DEFAULT_LANGUAGE;
}

export function writeLanguageCookie(language: Language) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${LANGUAGE_STORAGE_KEY}=${language}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

export function persistLanguage(language: Language) {
  writeLanguageCookie(language);
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* ignore */
  }
}

export function applyLanguageToDocument(language: Language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
}
