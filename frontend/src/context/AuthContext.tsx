"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { META_PIXEL_ID } from "../components/MetaPixel";

interface AuthContextType {
    user: User | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
});

// Run `cb` once window.fbq exists. The Pixel snippet defines fbq as a queuing
// stub synchronously when its inline script runs, so this only bridges the gap
// until that script executes; we poll briefly and give up if it never loads
// (ad blocker) — in which case the server-side CAPI event is the safety net.
function whenFbqReady(cb: (fbq: Window["fbq"]) => void, attempts = 0): void {
    if (typeof window === "undefined") return;
    if (window.fbq) {
        cb(window.fbq);
        return;
    }
    if (attempts >= 100) return; // ~20s (100 x 200ms) then stop waiting
    window.setTimeout(() => whenFbqReady(cb, attempts + 1), 200);
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);

            if (firebaseUser && typeof window !== 'undefined') {
                // Firebase restores the session almost instantly on load, but the
                // Pixel (loaded via <Script afterInteractive> from an external,
                // sometimes-slow/blocked host) may not be ready yet. Firing
                // immediately silently drops the event. Wait for window.fbq so
                // legitimate, non-blocked users are never lost to load order.
                whenFbqReady((fbq) => {
                    // Advanced Matching: attach user data so Meta can attribute
                    // conversions to ad clickers. Raw values are normalized +
                    // SHA-256 hashed client-side by the Pixel before they leave the
                    // browser.
                    const userData: Record<string, string> = { external_id: firebaseUser.uid };
                    if (firebaseUser.email) {
                        userData.em = firebaseUser.email.trim().toLowerCase();
                    }
                    fbq('init', META_PIXEL_ID, userData);

                    const isNewUser = firebaseUser.metadata.creationTime === firebaseUser.metadata.lastSignInTime;
                    if (isNewUser && !window.localStorage.getItem("fb_pixel_registered")) {
                        // Shared event_id with the server-side CAPI event so Meta
                        // dedupes the two channels into one registration.
                        fbq('track', 'CompleteRegistration', {}, { eventID: `reg_${firebaseUser.uid}` });
                        window.localStorage.setItem("fb_pixel_registered", "true");
                    }
                });
            }

            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
