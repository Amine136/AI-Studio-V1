"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { META_PIXEL_ID, whenFbqReady } from "../lib/pixel";

interface AuthContextType {
    user: User | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
});

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
                        fbq('track', 'CompleteRegistration', { value: 1.00, currency: 'USD' }, { eventID: `reg_${firebaseUser.uid}` });
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
