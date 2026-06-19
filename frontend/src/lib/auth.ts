import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
} from "firebase/auth";
import { auth } from "./firebase";

// localStorage keys for the passwordless email-link flow.
const EMAIL_FOR_SIGN_IN_KEY = "vibecraft_emailForSignIn";

// Returns a same-origin path for the email-link continue URL. Anything that is
// not a safe same-origin path (open-redirect attempts, the /auth page itself)
// falls back to /dashboard.
function safeNextPath(next?: string | null): string {
    if (!next || typeof window === "undefined") return "/dashboard";
    try {
        const url = new URL(next, window.location.origin);
        const path = `${url.pathname}${url.search}`;
        if (url.origin === window.location.origin && !path.startsWith("/auth")) {
            return path;
        }
    } catch {
        /* malformed next */
    }
    return "/dashboard";
}

export async function signUp(email: string, password: string) {
    return createUserWithEmailAndPassword(auth, email, password);
}

export async function signIn(email: string, password: string) {
    return signInWithEmailAndPassword(auth, email, password);
}

export async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    return signInWithPopup(auth, provider);
}

export async function signOutUser() {
    if (typeof window !== "undefined") {
        sessionStorage.setItem("signingOut", "true");
    }
    return signOut(auth);
}

// --- Passwordless email-link (magic link) sign-in -------------------------
// Web-only flow (no Firebase Dynamic Links): the link returns the user to
// /auth on our own authorized domain, where completeEmailLinkSignIn finishes it.

export async function sendEmailSignInLink(
    email: string,
    next?: string | null,
    lang?: string | null,
) {
    // Localize the Firebase-sent email to the user's UI language (en/fr/ar).
    // Firebase ships translated default templates, so this needs no template work.
    if (lang) {
        auth.languageCode = lang;
    } else {
        auth.useDeviceLanguage();
    }
    const continueUrl = `${window.location.origin}/auth?next=${encodeURIComponent(safeNextPath(next))}`;
    await sendSignInLinkToEmail(auth, email, {
        url: continueUrl,
        handleCodeInApp: true,
    });
    // Remember the address so we can complete the sign-in without re-prompting
    // when the link is opened in the same browser.
    window.localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, email);
}

export function isEmailSignInLink(href: string): boolean {
    return isSignInWithEmailLink(auth, href);
}

export function getStoredSignInEmail(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
}

export async function completeEmailLinkSignIn(email: string, href: string) {
    const result = await signInWithEmailLink(auth, email, href);
    window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
    return result;
}
